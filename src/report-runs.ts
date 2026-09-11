/**
 * 汇报的纯逻辑层：配置归一化、复盘提示词、结构化产物契约、brief 回写。
 *
 * 这里刻意不碰 I/O 与宿主服务——可测、可在客户端复用，也让 report.ts 只负责
 * 「取会话、发提示词、读写文件」。所有默认值与原行为一致：不配置就等于没改。
 */

/** 汇报的可配置契约（全部有默认值，缺省即旧行为）。 */
export interface ReportConfig {
  /** 数据根目录（相对于工作区）。 */
  dataRoot: string
  /** 每日简报目录名（dataRoot 之下）。 */
  briefDir: string
  /** 复盘产物目录名（dataRoot 之下）。 */
  reviewDir: string
  /** 导出目录名（dataRoot 之下）。 */
  exportDir: string
  /** 复盘按名加载的 skill；为空则只用内联步骤。 */
  reviewSkill: string
  /** 复盘执行位置：当前会话，或让 agent 派给子代理。 */
  dispatch: 'session' | 'subagent'
  /** 定时复盘（默认关闭；只在 DSH 进程存活期间生效）。 */
  schedule: { enabled: boolean; hour: number; checkMinutes: number }
  /** 单次复盘等待产物落盘的上限（毫秒）。 */
  runTimeoutMs: number
}

/** 复盘结构化产物的固定形状（键名与 report.ts 的校验一致）。 */
export interface ReviewReport {
  period: string
  projects: string[]
  completed: string[]
  learnings: string[]
  next: string[]
  openQuestions: string[]
  sourceBriefs: string[]
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  dataRoot: 'reporter',
  briefDir: 'brief',
  reviewDir: 'Review',
  exportDir: 'export',
  reviewSkill: 'aeon-review',
  dispatch: 'session',
  schedule: { enabled: false, hour: 22, checkMinutes: 30 },
  runTimeoutMs: 10 * 60 * 1000,
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function clock(value: unknown, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? Math.trunc(value) : fallback
}

/**
 * 归一化插件 config：任何缺失/非法字段都退回默认值，绝不因为一处配置写错
 * 就让汇报整块不可用（DSH 的 patch 层是整体替换 config，不是合并）。
 */
export function normalizeReportConfig(raw: unknown): ReportConfig {
  const value = (raw ?? {}) as Record<string, unknown>
  const schedule = (value.schedule ?? {}) as Record<string, unknown>
  const dispatch = value.dispatch === 'subagent' ? 'subagent' : 'session'
  return {
    dataRoot: text(value.dataRoot) ?? DEFAULT_REPORT_CONFIG.dataRoot,
    briefDir: text(value.briefDir) ?? DEFAULT_REPORT_CONFIG.briefDir,
    reviewDir: text(value.reviewDir) ?? DEFAULT_REPORT_CONFIG.reviewDir,
    exportDir: text(value.exportDir) ?? DEFAULT_REPORT_CONFIG.exportDir,
    reviewSkill: typeof value.reviewSkill === 'string' ? value.reviewSkill.trim() : DEFAULT_REPORT_CONFIG.reviewSkill,
    dispatch,
    schedule: {
      enabled: schedule.enabled === true,
      hour: clock(schedule.hour, 23, DEFAULT_REPORT_CONFIG.schedule.hour),
      checkMinutes: clock(schedule.checkMinutes, 24 * 60, DEFAULT_REPORT_CONFIG.schedule.checkMinutes) || DEFAULT_REPORT_CONFIG.schedule.checkMinutes,
    },
    runTimeoutMs: clock(value.runTimeoutMs, 24 * 60 * 60 * 1000, DEFAULT_REPORT_CONFIG.runTimeoutMs) || DEFAULT_REPORT_CONFIG.runTimeoutMs,
  }
}

/** 复盘产物的路径（相对于工作区）。 */
export function reviewArtifacts(config: ReportConfig, date: string): { markdown: string; json: string; directory: string } {
  const directory = `${config.dataRoot}/${config.reviewDir}`
  return { directory, markdown: `${directory}/${date}.md`, json: `${directory}/${date}.json` }
}

/**
 * 复盘提示词：优先按名加载 skill，同时把内联步骤写全作为回退——skill 未安装
 * 或其依赖（如 aeon_* MCP 工具）未挂载时，这一步仍然能跑完，不会把一个能用
 * 的按钮变成静默空操作。
 */
export function buildReviewPrompt(options: {
  config: ReportConfig
  date: string
  dispatch: 'session' | 'subagent'
}): string {
  const { config, date } = options
  const briefDir = `${config.dataRoot}/${config.briefDir}`
  const { markdown, json } = reviewArtifacts(config, date)
  const lines = [
    '【复盘任务】把每日简报整合成一份复盘。',
    '',
    '执行方式：',
    ...(config.reviewSkill === ''
      ? ['1. 直接按下面的步骤执行。']
      : [
        `1. 先加载技能「${config.reviewSkill}」（用 skill 工具，参数 name="${config.reviewSkill}"），按它的流程执行。`,
        '2. 若该技能不存在、或其依赖的工具未挂载，则忽略它，直接按下面的步骤执行——不要因为技能不可用而中止。',
      ]),
    ...(options.dispatch === 'subagent'
      ? ['3. 把这次复盘交给一个子代理完成（用 subagent 工具），你只负责汇总它的结论。']
      : []),
    '',
    '步骤：',
    `1. 读取 ${briefDir}/ 目录下所有 YYYY-MM-DD.md 简报。`,
    '2. 按「结构化观察」提炼跨项目的踩坑、决策、可复用知识点（每条带发生日期与来源项目）。',
    '3. 按「周期复盘」聚合：完成了什么、关键收获、下一步、涌现主题、未记录到的成就。',
    `4. 写两个文件（目录不存在则创建）：`,
    `   - ${markdown}：给人看的 markdown 复盘。`,
    `   - ${json}：机器读的结构化产物，必须是**只含下列键**的 JSON 对象，七个键全部必填：`,
    '     {',
    `       "period": "本次复盘覆盖的日期区间，如 2026-09-01 ~ ${date}",`,
    '       "projects": ["涉及的项目名"],',
    '       "completed": ["完成了什么，一条一句"],',
    '       "learnings": ["关键收获 / 可复用结论"],',
    '       "next": ["下一步"],',
    '       "openQuestions": ["还没想清楚或待验证的问题"],',
    '       "sourceBriefs": ["读了哪些简报文件，写文件名"]',
    '     }',
    '     数组元素一律是字符串；不要加额外键，不要用 markdown 代码块包住整个文件。',
    '完成后用一句话说明两个文件已写入的位置。',
  ]
  return lines.join('\n')
}

/** 把模型产出的 JSON 文本收成对象：容忍 ```json 围栏与前后废话。 */
export function extractJsonObject(raw: string): unknown {
  const value = String(raw ?? '').trim()
  if (value === '') return undefined
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? value).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) return undefined
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      return undefined
    }
  }
}

const REVIEW_KEYS: readonly (keyof ReviewReport)[] = [
  'period', 'projects', 'completed', 'learnings', 'next', 'openQuestions', 'sourceBriefs',
]

/**
 * 校验复盘结构化产物：七个键全部必填、只允许这七个、值类型正确。
 * 不通过就让面板回退到 markdown——契约漂移不该把一次成功的复盘变成白屏。
 */
export function validateReviewReport(raw: unknown): { ok: true; value: ReviewReport } | { ok: false; error: string } {
  const value = extractJsonObject(typeof raw === 'string' ? raw : '')
  const source = value !== undefined ? value : raw
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return { ok: false, error: '复盘产物不是 JSON 对象' }
  }
  const record = source as Record<string, unknown>
  const unknown = Object.keys(record).filter((key) => !REVIEW_KEYS.includes(key as keyof ReviewReport))
  if (unknown.length > 0) return { ok: false, error: `复盘产物含未知键：${unknown.join('、')}` }
  const missing = REVIEW_KEYS.filter((key) => !(key in record))
  if (missing.length > 0) return { ok: false, error: `复盘产物缺少键：${missing.join('、')}` }
  if (typeof record.period !== 'string' || record.period.trim() === '') {
    return { ok: false, error: 'period 必须是非空字符串' }
  }
  const lists: Record<string, string[]> = {}
  for (const key of REVIEW_KEYS) {
    if (key === 'period') continue
    const item = record[key]
    if (!Array.isArray(item) || item.some((entry) => typeof entry !== 'string')) {
      return { ok: false, error: `${key} 必须是字符串数组` }
    }
    lists[key] = item as string[]
  }
  return {
    ok: true,
    value: {
      period: record.period.trim(),
      projects: lists.projects!,
      completed: lists.completed!,
      learnings: lists.learnings!,
      next: lists.next!,
      openQuestions: lists.openQuestions!,
      sourceBriefs: lists.sourceBriefs!,
    },
  }
}

/** brief 的回写字段（与 brief skill 的契约一致）：条目是纯文本，编号由本函数生成。 */
export interface BriefItems {
  progress?: string[]
  todo?: string[]
  issues?: string[]
}

const BRIEF_SECTIONS: ReadonlyArray<{ key: keyof BriefItems; label: string }> = [
  { key: 'progress', label: '今日进度' },
  { key: 'todo', label: '待办' },
  { key: 'issues', label: '问题' },
]

function sectionPattern(label: string): RegExp {
  return new RegExp(`^\\s*[-*]?\\s*${label}\\s*[:：]\\s*$`)
}

function isItemLine(line: string): boolean {
  return /^\s*(?:\d+[.、)]|[-*])\s+\S/.test(line)
}

function isHeading(line: string): boolean {
  return /^#{1,2}\s/.test(line)
}

/**
 * 只追加、不改写：在 `## <project>` 区块内把条目追加到对应小节末尾，编号接续
 * 已有条目。区块或小节不存在就补建；已有正文一行都不动——回写简报最怕的就是
 * 覆盖掉人自己记的东西。
 */
export function appendBriefItems(text: string, project: string, items: BriefItems): string {
  const source = String(text ?? '')
  const pending = BRIEF_SECTIONS
    .map(({ key, label }) => ({ key, label, values: (items[key] ?? []).map((value) => value.trim()).filter((value) => value !== '') }))
    .filter(({ values }) => values.length > 0)
  if (pending.length === 0) return source

  const lines = source === '' ? [] : source.split('\n')
  const heading = `## ${project}`
  const start = lines.findIndex((line) => line.trim() === heading)

  if (start < 0) {
    const block = [heading]
    for (const { label, values } of pending) {
      block.push(`- ${label}：`)
      values.forEach((value, index) => block.push(`  ${index + 1}. ${value}`))
    }
    const trimmed = source.replace(/\s+$/, '')
    return `${trimmed === '' ? '' : `${trimmed}\n\n`}${block.join('\n')}\n`
  }

  // 区块边界：下一个同级或更高级标题，或文件末尾。
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isHeading(lines[index] ?? '')) { end = index; break }
  }

  // 小节行号：只认区块内的「- 今日进度：」这类独占一行的标签。
  const marks = BRIEF_SECTIONS.map(({ label }) => ({
    label,
    at: lines.findIndex((line, index) => index > start && index < end && sectionPattern(label).test(line)),
  }))

  for (const { label, values } of pending) {
    const mark = marks.find((entry) => entry.label === label)!
    if (mark.at < 0) {
      lines.splice(end, 0, `- ${label}：`, ...values.map((value, index) => `  ${index + 1}. ${value}`))
      end += 1 + values.length
      continue
    }
    // 该小节的内容区间 = 下一个已知小节行（或区块末尾）。
    const nexts = marks.map((entry) => entry.at).filter((at) => at > mark.at)
    const sectionEnd = nexts.length > 0 ? Math.min(...nexts) : end
    let count = 0
    let last = mark.at
    for (let index = mark.at + 1; index < sectionEnd; index += 1) {
      const line = lines[index] ?? ''
      if (line.trim() === '') continue
      if (!isItemLine(line)) continue
      count += 1
      last = index
    }
    lines.splice(last + 1, 0, ...values.map((value, index) => `  ${count + index + 1}. ${value}`))
    end += values.length
    for (const entry of marks) if (entry.at > mark.at) entry.at += values.length
  }
  return lines.join('\n')
}

/** 该简报是否已经过去重后的可复盘内容（定时触发前的一次便宜检查）。 */
export function briefHasProgress(projects: Array<{ progress: string[] }>): boolean {
  return projects.some((project) => project.progress.length > 0)
}
