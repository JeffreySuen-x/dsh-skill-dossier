import { describe, expect, it } from 'vitest'
import { ALL_FILTER, UNPROFILED_FILTER, skillFilterChips, skillMatchesFilter } from '../src/client/skill-filter.ts'

describe('skillFilterChips', () => {
  it('counts canonical directions in canonical order and keeps unprofiled apart', () => {
    const chips = skillFilterChips([
      { name: 'a', direction: '命理玄学' },
      { name: 'b', direction: '工程代码' },
      { name: 'c', direction: '工程代码' },
      { name: 'd', direction: undefined },
      { name: 'e', direction: '' },
    ])

    expect(chips).toEqual([
      { value: ALL_FILTER, label: '全部', count: 5 },
      { value: UNPROFILED_FILTER, label: '未建档', count: 2 },
      { value: '工程代码', label: '工程代码', count: 2 },
      { value: '命理玄学', label: '命理玄学', count: 1 },
    ])
  })

  it('omits directions that the current catalog does not use', () => {
    const values = skillFilterChips([{ name: 'a', direction: '本地模型' }]).map((chip) => chip.value)
    expect(values).toEqual([ALL_FILTER, UNPROFILED_FILTER, '本地模型'])
  })

  it('keeps only the two pseudo categories on an empty catalog', () => {
    expect(skillFilterChips([])).toEqual([
      { value: ALL_FILTER, label: '全部', count: 0 },
      { value: UNPROFILED_FILTER, label: '未建档', count: 0 },
    ])
  })
})

describe('skillMatchesFilter', () => {
  it('matches everything under 全部 and nothing under a direction when unprofiled', () => {
    expect(skillMatchesFilter(ALL_FILTER, '工程代码')).toBe(true)
    expect(skillMatchesFilter(ALL_FILTER, undefined)).toBe(true)
    expect(skillMatchesFilter('工程代码', '工程代码')).toBe(true)
    expect(skillMatchesFilter('工程代码', '命理玄学')).toBe(false)
    expect(skillMatchesFilter('工程代码', undefined)).toBe(false)
  })

  it('treats 未建档 as a real classification, not a fallback', () => {
    expect(skillMatchesFilter(UNPROFILED_FILTER, undefined)).toBe(true)
    expect(skillMatchesFilter(UNPROFILED_FILTER, '')).toBe(true)
    expect(skillMatchesFilter(UNPROFILED_FILTER, '工程代码')).toBe(false)
  })
})
