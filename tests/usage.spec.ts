import { describe, expect, it } from 'vitest'
import { recordUsage, skillGestures, summarizeUsage, RECENT_CAP, type UsageRecord } from '../src/usage.ts'

/** 本地时区中午，避免跨日边界：dayKey 稳定为对应日期。 */
function ts(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour, 0, 0).getTime()
}

describe('recordUsage', () => {
  it('creates a record on first use and buckets by day', () => {
    const usage: Record<string, UsageRecord> = {}
    recordUsage(usage, 'research', ts(2026, 8, 22))
    recordUsage(usage, 'research', ts(2026, 8, 22, 15))
    recordUsage(usage, 'research', ts(2026, 8, 23))
    const rec = usage['research']
    expect(rec?.count).toBe(3)
    expect(rec?.firstUsedAt).toBe(ts(2026, 8, 22))
    expect(rec?.lastUsedAt).toBe(ts(2026, 8, 23))
    expect(rec?.daily).toEqual({ '2026-08-22': 2, '2026-08-23': 1 })
  })

  it('caps the recent tail to RECENT_CAP entries', () => {
    const usage: Record<string, UsageRecord> = {}
    const start = ts(2026, 8, 1)
    for (let i = 0; i < RECENT_CAP + 5; i += 1) recordUsage(usage, 'x', start + i * 1000)
    const rec = usage['x']
    expect(rec?.count).toBe(RECENT_CAP + 5)
    expect(rec?.recent.length).toBe(RECENT_CAP)
    expect(rec?.recent[RECENT_CAP - 1]).toBe(start + (RECENT_CAP + 4) * 1000)
  })
})

describe('summarizeUsage', () => {
  it('sorts by count desc and computes per-day frequency', () => {
    const usage: Record<string, UsageRecord> = {}
    recordUsage(usage, 'a', ts(2026, 8, 22))
    recordUsage(usage, 'b', ts(2026, 8, 22))
    recordUsage(usage, 'b', ts(2026, 8, 23))
    const summaries = summarizeUsage(usage, ts(2026, 8, 24))
    expect(summaries.map((s) => s.name)).toEqual(['b', 'a'])
    expect(summaries[0]?.activeDays).toBe(2)
    expect(summaries[0]?.callsPerDay).toBe(1)
    expect(summaries[0]?.lastUsedDaysAgo).toBe(1)
  })
})

describe('skillGestures', () => {
  it('extracts and dedupes /name tokens', () => {
    expect(skillGestures('用 /research 查一下，再 /research 一次')).toEqual(['research'])
  })

  it('ignores file paths and fractions', () => {
    expect(skillGestures('看 /usr/bin 和 5/8 的比例')).toEqual([])
  })

  it('matches a gesture anywhere in the sentence', () => {
    expect(skillGestures('帮我 /code-review 这段代码')).toEqual(['code-review'])
  })
})
