/**
 * 保鲜信号：从方向易变性 + 使用频率 + 复审时间，算出「哪些技能该复审」的
 * 优先级排序。纯函数、无 I/O，便于单测。复审本身（内容是否过时、是否有效）
 * 交给 darwin-skill 在对话框外做，这里只负责「发现 + 排序」。
 */
import { DIRECTIONS } from './directions.ts'
import type { UsageRecord } from './usage.ts'

const DAY_MS = 86400000

const VOLATILITY = new Map(DIRECTIONS.map((d) => [d.label, d.volatility]))

/** 一条待复审候选。 */
export interface ReviewEntry {
  name: string
  direction: string
  volatility: 'high' | 'low'
  /** 距上次使用的天数；null = 从未使用。 */
  daysSinceUse: number | null
  /** 距上次复审的天数；null = 从未复审。 */
  daysSinceReviewed: number | null
  /** 命中理由（中文标签）。 */
  reasons: string[]
  /** 优先级，越高越该复审。 */
  priority: number
}

/** 参与排序的最小档案字段集。 */
interface ReviewSkill {
  name: string
  direction?: string
  reviewedAt?: number
}

/**
 * 计算待复审候选并按优先级降序取前 topK 条。
 * @param skills 已建档技能（含 direction / reviewedAt）。
 * @param usage 调用统计。
 * @param now 当前时间戳（ms）。
 * @param topK 返回条数。
 */
export function reviewCandidates(
  skills: Record<string, ReviewSkill>,
  usage: Record<string, UsageRecord>,
  now: number,
  topK: number,
): ReviewEntry[] {
  const entries: ReviewEntry[] = []
  for (const [name, skill] of Object.entries(skills)) {
    const direction = typeof skill.direction === 'string' && skill.direction !== '' ? skill.direction : '未标注'
    const volatility = VOLATILITY.get(direction) ?? 'low'
    const rec = usage[name]
    const daysSinceUse = rec === undefined ? null : Math.floor((now - rec.lastUsedAt) / DAY_MS)
    const daysSinceReviewed = skill.reviewedAt === undefined ? null : Math.floor((now - skill.reviewedAt) / DAY_MS)

    let priority = 0
    const reasons: string[] = []
    if (volatility === 'high') { priority += 2; reasons.push('易变方向') }
    if (daysSinceUse === null) { priority += 3; reasons.push('从未使用') }
    else if (daysSinceUse > 60) { priority += 3; reasons.push(`长期未用(${daysSinceUse}天)`) }
    else if (daysSinceUse > 30) { priority += 2; reasons.push(`较久未用(${daysSinceUse}天)`) }
    if (daysSinceReviewed === null) { priority += 2; reasons.push('从未复审') }
    else if (daysSinceReviewed > 90) { priority += 2; reasons.push(`久未复审(${daysSinceReviewed}天)`) }

    entries.push({ name, direction, volatility, daysSinceUse, daysSinceReviewed, reasons, priority })
  }
  return entries
    .filter((e) => e.priority > 0)
    .sort((a, b) => b.priority - a.priority
      || (a.daysSinceUse ?? Number.MAX_SAFE_INTEGER) - (b.daysSinceUse ?? Number.MAX_SAFE_INTEGER)
      || a.name.localeCompare(b.name))
    .slice(0, topK)
}

/**
 * 把待复审候选渲染成给模型看的一行一条的紧凑文本。
 */
export function formatReview(entries: ReviewEntry[], total: number): string {
  if (entries.length === 0) {
    return `在 ${total} 条技能里没有明显待复审的（无长期未用 / 无易变方向久置）。`
  }
  const lines = entries.map((e, i) => `${i + 1}. ${e.name} — ${e.direction}（${e.reasons.join('、')}）`)
  return `在 ${total} 条技能里，待复审优先级最高的 ${entries.length} 条：\n\n${lines.join('\n')}\n\n对可疑的一条用 skill_eval 触发 darwin-skill 评测。`
}
