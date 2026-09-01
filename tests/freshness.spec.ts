import { describe, expect, it } from 'vitest'
import { formatReview, reviewCandidates } from '../src/freshness.ts'
import type { UsageRecord } from '../src/usage.ts'

const DAY = 86400000
const now = Date.now()

function skill(name: string, direction: string, reviewedAt?: number) {
  return { name, direction, reviewedAt }
}

describe('reviewCandidates', () => {
  it('flags a high-volatility never-used skill over a stable one', () => {
    const skills = {
      'image-to-code': skill('image-to-code', '前端视觉'),        // 易变 + 从未使用
      'aeon-review': skill('aeon-review', '记忆会话'),            // 稳定 + 从未使用
    }
    const usage: Record<string, UsageRecord> = {}
    const entries = reviewCandidates(skills, usage, now, 10)
    expect(entries[0]?.name).toBe('image-to-code')
    expect(entries[0]?.reasons).toContain('易变方向')
  })

  it('ranks long-unused over recently-used', () => {
    const skills = {
      'a': skill('a', '工程代码', now - 30 * DAY),
      'b': skill('b', '工程代码', now - 30 * DAY),
    }
    const usage: Record<string, UsageRecord> = {
      a: { count: 5, firstUsedAt: now - 90 * DAY, lastUsedAt: now - 90 * DAY, daily: {}, recent: [] },
      b: { count: 5, firstUsedAt: now - 1 * DAY, lastUsedAt: now - 1 * DAY, daily: {}, recent: [] },
    }
    const entries = reviewCandidates(skills, usage, now, 10)
    expect(entries[0]?.name).toBe('a')
    expect(entries[0]?.reasons.some((r) => r.includes('长期未用'))).toBe(true)
  })

  it('excludes skills with no signal', () => {
    const skills = { 'x': skill('x', '记忆会话', now - 1 * DAY) }
    const usage: Record<string, UsageRecord> = {
      x: { count: 1, firstUsedAt: now - 1 * DAY, lastUsedAt: now - 1 * DAY, daily: {}, recent: [] },
    }
    expect(reviewCandidates(skills, usage, now, 10)).toEqual([])
  })
})

describe('formatReview', () => {
  it('reports empty explicitly', () => {
    expect(formatReview([], 3)).toContain('没有明显待复审')
  })

  it('lists candidates with reasons', () => {
    const text = formatReview([
      { name: 'x', direction: '前端视觉', volatility: 'high', daysSinceUse: null, daysSinceReviewed: null, reasons: ['易变方向', '从未使用'], priority: 5 },
    ], 3)
    expect(text).toContain('x')
    expect(text).toContain('易变方向')
  })
})
