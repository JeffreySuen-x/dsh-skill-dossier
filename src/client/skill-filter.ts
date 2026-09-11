/**
 * 「技能」页复用的「档案」页分类口径：方向分类仍以 directions.ts 的
 * canonical 10 类为准，另加「全部 / 未建档」两个列表页特有的伪分类。
 * 抽成纯函数是为了能在没有 DOM 的 vitest 下直接断言——组件本身不做渲染测试。
 */
import { DIRECTION_LABELS } from '../directions.ts'

/** 列表页分类值：「全部」。 */
export const ALL_FILTER = 'all'
/** 列表页分类值：「未建档」。 */
export const UNPROFILED_FILTER = 'unprofiled'

/** 一个分类 chip：值唯一，计数为当前目录里命中该分类的技能数。 */
export interface SkillFilterChip {
  value: string
  label: string
  count: number
}

/** 技能条目里本模块关心的字段。 */
export interface FilterableSkill {
  name: string
  direction: string | undefined
}

/** 是否已建档：方向是非空字符串——与 host 写档案时的校验口径一致。 */
export function isProfiledSkill(direction: string | undefined): boolean {
  return typeof direction === 'string' && direction !== ''
}

/** 判断一个技能是否命中分类值；未知分类值一律不命中。 */
export function skillMatchesFilter(filter: string, direction: string | undefined): boolean {
  if (filter === ALL_FILTER) return true
  if (filter === UNPROFILED_FILTER) return !isProfiledSkill(direction)
  return direction === filter
}

/**
 * 技能目录页的分类 chip：全部、未建档，以及**当前目录里确实有技能**的方向
 * （按 canonical 顺序）。空方向不出现——这里给的是当前目录的分类，不是分类总表。
 */
export function skillFilterChips(skills: readonly FilterableSkill[]): SkillFilterChip[] {
  const counts = new Map<string, number>()
  let unprofiled = 0
  for (const skill of skills) {
    if (!isProfiledSkill(skill.direction)) {
      unprofiled += 1
      continue
    }
    const direction = skill.direction as string
    counts.set(direction, (counts.get(direction) ?? 0) + 1)
  }
  const directionChips = DIRECTION_LABELS
    .filter((label) => (counts.get(label) ?? 0) > 0)
    .map((label) => ({ value: label, label, count: counts.get(label) ?? 0 }))
  return [
    { value: ALL_FILTER, label: '全部', count: skills.length },
    { value: UNPROFILED_FILTER, label: '未建档', count: unprofiled },
    ...directionChips,
  ]
}
