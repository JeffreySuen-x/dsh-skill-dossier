import { describe, expect, it } from 'vitest'
import {
  appendBriefItems,
  briefHasProgress,
  buildReviewPrompt,
  DEFAULT_REPORT_CONFIG,
  extractJsonObject,
  normalizeReportConfig,
  reviewArtifacts,
  validateReviewReport,
} from '../src/report-runs.ts'

const validReport = {
  period: '2026-09-01 ~ 2026-09-11',
  projects: ['插件'],
  completed: ['修好索引写路径'],
  learnings: ['沙箱策略要显式传'],
  next: ['补 CI'],
  openQuestions: [],
  sourceBriefs: ['2026-09-11.md'],
}

describe('normalizeReportConfig', () => {
  it('falls back to the historical defaults for anything missing', () => {
    expect(normalizeReportConfig(undefined)).toEqual(DEFAULT_REPORT_CONFIG)
    expect(normalizeReportConfig({}).dataRoot).toBe('reporter')
    expect(normalizeReportConfig({}).runTimeoutMs).toBe(10 * 60 * 1000)
  })

  it('keeps valid overrides', () => {
    const config = normalizeReportConfig({
      dataRoot: 'worklog',
      briefDir: 'daily',
      reviewDir: 'Retro',
      exportDir: 'out',
      reviewSkill: 'aeon-review',
      dispatch: 'subagent',
      runTimeoutMs: 1000,
      schedule: { enabled: true, hour: 9, checkMinutes: 15 },
    })
    expect(config).toMatchObject({
      dataRoot: 'worklog',
      briefDir: 'daily',
      reviewDir: 'Retro',
      exportDir: 'out',
      dispatch: 'subagent',
      runTimeoutMs: 1000,
      schedule: { enabled: true, hour: 9, checkMinutes: 15 },
    })
  })

  it('ignores malformed values instead of breaking the report half', () => {
    const config = normalizeReportConfig({
      dataRoot: 42,
      dispatch: 'nonsense',
      runTimeoutMs: -1,
      schedule: { enabled: 'yes', hour: 99, checkMinutes: 0 },
    })
    expect(config.dataRoot).toBe('reporter')
    expect(config.dispatch).toBe('session')
    expect(config.runTimeoutMs).toBe(DEFAULT_REPORT_CONFIG.runTimeoutMs)
    expect(config.schedule).toEqual({ enabled: false, hour: 22, checkMinutes: 30 })
  })
})

describe('reviewArtifacts', () => {
  it('follows the configured directories', () => {
    expect(reviewArtifacts(DEFAULT_REPORT_CONFIG, '2026-09-11')).toEqual({
      directory: 'reporter/Review',
      markdown: 'reporter/Review/2026-09-11.md',
      json: 'reporter/Review/2026-09-11.json',
    })
    expect(reviewArtifacts(normalizeReportConfig({ dataRoot: 'worklog', reviewDir: 'Retro' }), '2026-09-11').json)
      .toBe('worklog/Retro/2026-09-11.json')
  })
})

describe('buildReviewPrompt', () => {
  it('asks for the named skill but keeps a working inline fallback', () => {
    const prompt = buildReviewPrompt({ config: DEFAULT_REPORT_CONFIG, date: '2026-09-11', dispatch: 'session' })
    expect(prompt).toContain('aeon-review')
    expect(prompt).toContain('不要因为技能不可用而中止')
    expect(prompt).toContain('reporter/Review/2026-09-11.json')
    expect(prompt).toContain('reporter/Review/2026-09-11.md')
    for (const key of ['period', 'projects', 'completed', 'learnings', 'next', 'openQuestions', 'sourceBriefs']) {
      expect(prompt).toContain(key)
    }
  })

  it('drops the skill step when no skill is configured and can request a subagent', () => {
    const prompt = buildReviewPrompt({
      config: normalizeReportConfig({ reviewSkill: '', dispatch: 'subagent' }),
      date: '2026-09-11',
      dispatch: 'subagent',
    })
    expect(prompt).not.toContain('先加载技能')
    expect(prompt).toContain('子代理')
  })
})

describe('extractJsonObject', () => {
  it('accepts bare, fenced, and prose-wrapped JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJsonObject('写好了：\n{"a":1}\n以上。')).toEqual({ a: 1 })
  })

  it('returns undefined for unusable input', () => {
    expect(extractJsonObject('')).toBeUndefined()
    expect(extractJsonObject('没有 JSON')).toBeUndefined()
  })
})

describe('validateReviewReport', () => {
  it('accepts the exact contract', () => {
    expect(validateReviewReport(validReport)).toEqual({ ok: true, value: validReport })
  })

  it('rejects a missing key, an extra key, and wrong element types', () => {
    const missing = { ...validReport } as Record<string, unknown>
    delete missing.next
    expect(validateReviewReport(missing)).toMatchObject({ ok: false })
    expect(String((validateReviewReport(missing) as { error: string }).error)).toContain('next')

    expect(validateReviewReport({ ...validReport, extra: 1 })).toMatchObject({ ok: false })
    expect(validateReviewReport({ ...validReport, completed: [1, 2] })).toMatchObject({ ok: false })
    expect(validateReviewReport({ ...validReport, period: '' })).toMatchObject({ ok: false })
    expect(validateReviewReport('不是对象')).toMatchObject({ ok: false })
  })
})

describe('appendBriefItems', () => {
  const brief = [
    '---',
    'date: 2026-09-11',
    '---',
    '',
    '# Brief',
    '',
    '## 插件',
    '- 作用：管理技能',
    '- 实现：host + client',
    '- 今日进度：',
    '  1. 修好索引写路径',
    '- 待办：',
    '  1. 补 CI',
    '- 问题：',
    '',
    '## 别的项目',
    '- 作用：x',
  ].join('\n')

  it('appends into the matching section, continuing the numbering, without touching existing lines', () => {
    const result = appendBriefItems(brief, '插件', { progress: ['打通复盘链路'], issues: ['定时未验证'] })
    expect(result).toContain('  1. 修好索引写路径\n  2. 打通复盘链路')
    expect(result).toContain('- 问题：\n  1. 定时未验证')
    expect(result).toContain('## 别的项目')
    for (const line of ['- 作用：管理技能', '- 实现：host + client', '  1. 补 CI']) expect(result).toContain(line)
  })

  it('creates a missing section and a missing project block', () => {
    const newSection = appendBriefItems('## 插件\n- 作用：x\n', '插件', { todo: ['新待办'] })
    expect(newSection).toContain('- 待办：\n  1. 新待办')

    const newProject = appendBriefItems(brief, '新项目', { progress: ['第一条'] })
    expect(newProject).toContain('## 新项目')
    expect(newProject).toContain('- 今日进度：\n  1. 第一条')
    expect(newProject.startsWith(brief)).toBe(true)
  })

  it('never treats a neighbouring section label as an item of the previous one', () => {
    const result = appendBriefItems(brief, '插件', { progress: ['新进度'] })
    expect(result).toContain('  1. 修好索引写路径\n  2. 新进度\n- 待办：')
  })

  it('is a no-op for empty or blank items', () => {
    expect(appendBriefItems(brief, '插件', {})).toBe(brief)
    expect(appendBriefItems(brief, '插件', { progress: ['', '   '] })).toBe(brief)
  })
})

describe('briefHasProgress', () => {
  it('detects a brief worth reviewing', () => {
    expect(briefHasProgress([{ progress: [] }, { progress: ['x'] }])).toBe(true)
    expect(briefHasProgress([{ progress: [] }])).toBe(false)
  })
})
