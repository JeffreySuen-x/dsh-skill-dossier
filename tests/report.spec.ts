import { describe, expect, it } from 'vitest'
import { reportFailureMessage } from '../src/client/report-state.ts'
import { parseBrief, pickDailyDate, pickMonth, toMarkdown } from '../src/report.ts'

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
    expect(pickMonth(['2026-08-30', '2026-08-31'], '2026-09')).toEqual({ month: '2026-08', fallbackMonth: '2026-08', dates: ['2026-08-30', '2026-08-31'] })
    expect(pickMonth([], '2026-09')).toEqual({ month: '2026-09', fallbackMonth: '', dates: [] })
  })

  it('renders monthly progress and issues as content, not counters', () => {
    const markdown = toMarkdown({
      month: '2026-09',
      days: [{ date: '2026-09-03', projects: ['管理插件'], progress: ['完成单包汇报'], todo: ['补安装冒烟'], issues: ['Windows 待验证'] }],
      projects: [{ name: '管理插件', purpose: '管理技能', impl: 'host + client', progress: ['完成单包汇报'], todo: ['补安装冒烟'], issues: ['Windows 待验证'] }],
    }, 'monthly')

    expect(markdown).toContain('完成单包汇报')
    expect(markdown).toContain('Windows 待验证')
    expect(markdown).not.toContain('progressTotal')
  })

  it('escapes markdown table delimiters and line breaks in brief content', () => {
    const markdown = toMarkdown({
      month: '2026-09',
      days: [{ date: '2026-09-03', projects: ['A | B', 'C \\| D'], progress: ['第一行\n第二行'], todo: [], issues: [] }],
      projects: [],
    }, 'monthly')

    expect(markdown).toContain('A &#124; B')
    expect(markdown).toContain('C \\&#124; D')
    expect(markdown).toContain('第一行<br>第二行')
  })

  it('surfaces structured report failures to the client state', () => {
    expect(reportFailureMessage({ lastError: '简报读取失败' })).toBe('简报读取失败')
    expect(reportFailureMessage({ lastError: '' })).toBe('')
    expect(reportFailureMessage({})).toBe('')
  })
})
