/**
 * 技能匹配：给定当前任务的一句话描述，从已建档技能中按确定性评分选出
 * 最相关的若干条，把候选收窄到短名单；最终语义判断交给模型。
 *
 * 评分是朴素的文本启发式：方向关键词命中 + 字符二元组重叠 + 技能名
 * 词元命中。它不追求语义精确，只负责「把明显相关的排在前面」。
 */
import { detectDirections } from './directions.ts'

/** 建档技能档案里参与匹配的最小字段集。 */
export interface SkillProfile {
  name: string
  direction?: string
  useScope?: string
  boundaries?: string
  scenarios?: string
  notes?: string
}

/** 一条匹配结果（已把长字段截短，供模型阅读）。 */
export interface SkillMatch {
  name: string
  direction: string
  useScope: string
  scenarios: string
  score: number
  matched: string[]
}

/** 匹配选项。 */
export interface MatchOptions {
  topK: number
  direction?: string
}

const TRUNCATE = 160

function truncate(text: string | undefined, max = TRUNCATE): string {
  if (text === undefined || text === '') return ''
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

function clean(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function bigrams(text: string): Map<string, number> {
  const map = new Map<string, number>()
  const t = clean(text)
  for (let i = 0; i + 1 < t.length; i += 1) {
    const g = t.slice(i, i + 2)
    map.set(g, (map.get(g) ?? 0) + 1)
  }
  return map
}

/** 查询与目标文本的字符二元组重叠率（0..1），中文下近似「共用词块」程度。 */
function overlapScore(query: string, target: string): number {
  const q = bigrams(query)
  const t = bigrams(target)
  if (q.size === 0) return 0
  let hits = 0
  for (const g of q.keys()) {
    if (t.has(g)) hits += 1
  }
  return hits / q.size
}

function nameTokens(name: string): string[] {
  return name.toLowerCase().split('-').filter((t) => t.length >= 2)
}

/**
 * 给单条技能档案打分，并附带命中的理由标签。
 * @param query 当前任务的一句话描述
 * @param profile 建档档案
 * @param extraText 额外参与重叠的文本（通常是注册表里的 description/whenToUse）
 */
export function scoreSkill(query: string, profile: SkillProfile, extraText = ''): SkillMatch {
  const searchText = [
    profile.name,
    profile.direction ?? '',
    profile.useScope ?? '',
    profile.scenarios ?? '',
    profile.notes ?? '',
    extraText,
  ].join(' ')
  const matched: string[] = []
  let score = 0
  const directions = detectDirections(query)
  if (profile.direction !== undefined && profile.direction !== '' && directions.includes(profile.direction)) {
    score += 3
    matched.push(`方向:${profile.direction}`)
  }
  const overlap = overlapScore(query, searchText)
  if (overlap > 0) {
    score += overlap * 5
    matched.push(`文本重叠 ${Math.round(overlap * 100)}%`)
  }
  for (const token of nameTokens(profile.name)) {
    if (query.toLowerCase().includes(token)) {
      score += 2
      matched.push(`名称:${token}`)
      break
    }
  }
  return {
    name: profile.name,
    direction: profile.direction !== undefined && profile.direction !== '' ? profile.direction : '未标注',
    useScope: truncate(profile.useScope),
    scenarios: truncate(profile.scenarios),
    score: Math.round(score * 10) / 10,
    matched,
  }
}

/**
 * 对建档技能排序并取前 topK 条（可选按方向过滤）。
 * @param query 当前任务的一句话描述
 * @param profiles 建档档案列表
 * @param options 匹配选项
 * @param extraText 技能名 → 额外文本（注册表描述等），缺省为空
 */
export function matchSkills(
  query: string,
  profiles: SkillProfile[],
  options: MatchOptions,
  extraText: Map<string, string> = new Map(),
): SkillMatch[] {
  const filtered = options.direction === undefined
    ? profiles
    : profiles.filter((p) => p.direction === options.direction)
  return filtered
    .map((p) => scoreSkill(query, p, extraText.get(p.name) ?? ''))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, options.topK)
}

/**
 * 把匹配结果渲染成给模型看的一行一条的紧凑文本。
 * @param matches 匹配结果
 * @param total 建档技能总数
 * @param query 原始任务描述
 */
export function formatMatches(matches: SkillMatch[], total: number, query: string): string {
  if (matches.length === 0) {
    return `在 ${total} 条已建档技能里没有找到与「${query}」明显相关的候选。可以换更宽的关键词，或用 skill 工具直接加载你已知的某个技能。`
  }
  const lines = matches.map((m, i) => {
    const tag = m.matched.length > 0 ? ` [${m.matched.join(' · ')}]` : ''
    return `${i + 1}. ${m.name} — ${m.direction}（相关度 ${m.score}）${tag}\n   适用：${m.useScope || '—'}\n   场景：${m.scenarios || '—'}`
  })
  return `在 ${total} 条已建档技能中，与「${query}」最相关的前 ${matches.length} 条：\n\n${lines.join('\n\n')}\n\n对最匹配的一条调用 skill 工具加载全文后再执行；若无满意结果，可指定 direction 过滤或增大 topK。`
}
