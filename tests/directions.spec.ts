import { describe, expect, it } from 'vitest'
import { DIRECTION_HINTS, DIRECTION_LABELS, isDirectionLabel } from '../src/directions.ts'

describe('DIRECTION_LABELS', () => {
  it('is the canonical 10-category set', () => {
    expect(DIRECTION_LABELS).toEqual([
      '工程代码', '前端视觉', '调研报告', '内容写作', '知识库',
      '记忆会话', '多代理编排', '本地模型', '元技能', '命理玄学',
    ])
  })

  it('gives every label a one-line hint', () => {
    for (const label of DIRECTION_LABELS) expect(DIRECTION_HINTS[label]).toBeTruthy()
  })
})

describe('isDirectionLabel', () => {
  it('accepts only canonical labels', () => {
    expect(isDirectionLabel('工程代码')).toBe(true)
    expect(isDirectionLabel('命理玄学')).toBe(true)
    expect(isDirectionLabel('开发工程')).toBe(false)
    expect(isDirectionLabel('')).toBe(false)
  })
})
