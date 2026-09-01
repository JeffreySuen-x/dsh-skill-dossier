import { describe, expect, it } from 'vitest'
import { detectDirections, DIRECTION_LABELS, isDirectionLabel } from '../src/directions.ts'

describe('DIRECTION_LABELS', () => {
  it('is the canonical 10-category set', () => {
    expect(DIRECTION_LABELS).toEqual([
      '工程代码', '前端视觉', '调研报告', '内容写作', '知识库',
      '记忆会话', '多代理编排', '本地模型', '元技能', '命理玄学',
    ])
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

describe('detectDirections', () => {
  it('routes a coding query to 工程代码', () => {
    expect(detectDirections('帮我 review 这段代码并补测试')).toContain('工程代码')
  })

  it('routes a fortune query to 命理玄学', () => {
    expect(detectDirections('排一个八字盘看周运')).toContain('命理玄学')
  })

  it('routes a local-ollama query to 本地模型', () => {
    expect(detectDirections('用本地 ollama 预处理这张截图')).toContain('本地模型')
  })

  it('routes a parallel-agents query to 多代理编排', () => {
    expect(detectDirections('把这两个独立任务并行分发给子代理')).toContain('多代理编排')
  })
})
