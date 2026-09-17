import { describe, expect, it } from 'vitest'
import { reportFailureMessage } from '../src/client/report-state.ts'
import { parseBrief, pickDailyDate, pickMonth, pickWeek } from '../src/report.ts'

describe('brief report contract', () => {
  it('parses numbered and bulleted project fields', () => {
    const projects = parseBrief([
      '## 管理插件',
      '- 作用：管理技能',
      '- 实现：host + client',
      '- 今日进度：',
      '  1. 完成单包汇报',
      '- 待办：',
      '  - 补安装冒烟',
      '- 问题：',
      '  * Windows 待验证',
    ].join('\n'))

    expect(projects).toEqual([{
      name: '管理插件',
      purpose: '管理技能',
      impl: 'host + client',
      progress: ['完成单包汇报'],
      todo: ['补安装冒烟'],
      issues: ['Windows 待验证'],
    }])
  })

  it('selects current or latest daily data', () => {
    expect(pickDailyDate(['2026-09-02', '2026-09-03'], '2026-09-03')).toEqual({ date: '2026-09-03', fallbackFrom: '' })
    expect(pickDailyDate(['2026-09-02'], '2026-09-03')).toEqual({ date: '2026-09-02', fallbackFrom: '2026-09-03' })
    expect(pickDailyDate([], '2026-09-03')).toEqual({ date: '', fallbackFrom: '' })
  })

  it('selects current or latest monthly data', () => {
    expect(pickMonth(['2026-08-31', '2026-09-03'], '2026-09')).toEqual({ month: '2026-09', fallbackMonth: '', dates: ['2026-09-03'] })
    // 回退时 fallbackMonth 报的是**请求的**月份（客户端渲染「回退自 X」），
    // 不是回退到的那个月——否则月报会显示「2026-08 · 回退自 2026-08」。
    expect(pickMonth(['2026-08-30', '2026-08-31'], '2026-09')).toEqual({ month: '2026-08', fallbackMonth: '2026-09', dates: ['2026-08-30', '2026-08-31'] })
    expect(pickMonth([], '2026-09')).toEqual({ month: '2026-09', fallbackMonth: '', dates: [] })
  })

  it('surfaces structured report failures to the client state', () => {
    expect(reportFailureMessage({ lastError: '简报读取失败' })).toBe('简报读取失败')
    expect(reportFailureMessage({ lastError: '' })).toBe('')
    expect(reportFailureMessage({})).toBe('')
  })
})

describe('pickWeek', () => {
  it('returns the Monday..Sunday week containing today', () => {
    const pick = pickWeek(['2026-09-11'], '2026-09-11')
    expect(pick.dates).toHaveLength(7)
    expect(pick.dates).toContain('2026-09-11')
    expect(new Date(`${pick.dates[0]}T00:00:00`).getDay()).toBe(1)
    expect(new Date(`${pick.dates[6]}T00:00:00`).getDay()).toBe(0)
    expect(pick.fallbackFrom).toBe('')
  })

  it('falls back to the latest week that has data when this week is empty', () => {
    const pick = pickWeek(['2026-09-01'], '2026-09-11')
    expect(pick.dates).toContain('2026-09-01')
    expect(pick.fallbackFrom).toBe('2026-09-11')
  })

  it('still yields a full week when there is no data at all', () => {
    const pick = pickWeek([], '2026-09-11')
    expect(pick.dates).toHaveLength(7)
    expect(pick.fallbackFrom).toBe('')
  })
})
