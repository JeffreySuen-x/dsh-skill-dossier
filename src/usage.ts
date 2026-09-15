/**
 * 技能调用使用统计：把一次调用折叠进按技能分组的记录，按天聚合、
 * 计算频率。纯函数、无 I/O，便于单测。
 */

/** 单个技能的调用统计。 */
export interface UsageRecord {
  /** 累计调用次数。 */
  count: number
  /** 首次调用时间戳（ms）。 */
  firstUsedAt: number
  /** 最近一次调用时间戳（ms）。 */
  lastUsedAt: number
  /** 'YYYY-MM-DD'（本地时区）→ 当天调用次数。 */
  daily: Record<string, number>
  /** 最近 {@link RECENT_CAP} 次调用的时间戳，按发生顺序（末尾最新）。 */
  recent: number[]
}

/** recent 数组保留的最大条数，防止长期累积撑大 index.json。 */
export const RECENT_CAP = 20

/** 本地时区的 'YYYY-MM-DD' 键。 */
export function dayKey(at: number): string {
  const d = new Date(at)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * 把一次调用折叠进 usage 表（原地修改），返回被更新的记录。
 * @param usage 按技能名分组的调用统计（可空表）。
 * @param name 技能名（kebab-case）。
 * @param at 本次调用时间戳（ms）。
 */
export function recordUsage(usage: Record<string, UsageRecord>, name: string, at: number): UsageRecord {
  const prev = usage[name]
  const rec: UsageRecord = prev ?? { count: 0, firstUsedAt: at, lastUsedAt: at, daily: {}, recent: [] }
  rec.count += 1
  rec.lastUsedAt = at
  const key = dayKey(at)
  rec.daily[key] = (rec.daily[key] ?? 0) + 1
  rec.recent.push(at)
  if (rec.recent.length > RECENT_CAP) rec.recent.splice(0, rec.recent.length - RECENT_CAP)
  usage[name] = rec
  return rec
}

/** 一个技能的聚合统计（供展示/文本渲染）。 */
export interface UsageSummary {
  name: string
  count: number
  firstUsedAt: number
  lastUsedAt: number
  /** 有调用记录的不同天数。 */
  activeDays: number
  /** 平均每天调用次数（count / activeDays，保留 1 位小数）。 */
  callsPerDay: number
  /** 距最近一次调用的整天数。 */
  lastUsedDaysAgo: number
}

/**
 * 把整张 usage 表聚合成按调用次数降序的摘要列表。
 * @param usage 按技能名分组的调用统计。
 * @param now 当前时间戳（ms），用于计算 lastUsedDaysAgo。
 */
export function summarizeUsage(usage: Record<string, UsageRecord>, now: number): UsageSummary[] {
  return Object.entries(usage)
    .map(([name, rec]) => {
      const activeDays = Object.keys(rec.daily).length
      const callsPerDay = activeDays === 0 ? rec.count : Math.round((rec.count / activeDays) * 10) / 10
      const lastUsedDaysAgo = Math.max(0, Math.floor((now - rec.lastUsedAt) / 86400000))
      return {
        name,
        count: rec.count,
        firstUsedAt: rec.firstUsedAt,
        lastUsedAt: rec.lastUsedAt,
        activeDays,
        callsPerDay,
        lastUsedDaysAgo,
      }
    })
    .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name))
}

/** 用户消息里的 /name 手势：匹配 `/[a-z0-9-]+`，词边界与工具端一致。 */
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

/**
 * 从一段用户文本里提取 /name 手势命中的技能名（去重、保序）。
 * @param text 用户输入的纯文本。
 */
export function skillGestures(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(SKILL_GESTURE)) {
    const name = match[2]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}
