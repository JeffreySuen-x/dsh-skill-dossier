import { createRpcRoute } from './http.ts'


/**
 * 汇报只做一件事：把 `reporter/brief/` 里的每日简报读出来，按日或按月摊平。
 *
 * 这里刻意没有「复盘 / 导出 / 运行记录」——复盘是 agent 干的事（让 agent 直接读
 * brief），导出是复制粘贴能替代的，运行记录是给一个不存在的调度器准备的。
 * 三者都要额外状态、额外写盘、额外失败面，而日报/月度本身只需要读。
 */

/** 数据目录可配置，默认就是历史行为。 */
export interface ReportConfig {
  /** 数据根目录（相对于工作区）。 */
  dataRoot: string
  /** 每日简报目录名（dataRoot 之下）。 */
  briefDir: string
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = { dataRoot: 'reporter', briefDir: 'brief' }

/** 归一化插件 config：缺失或非法一律退回默认值。 */
export function normalizeReportConfig(raw: unknown): ReportConfig {
  const value = (raw ?? {}) as Record<string, unknown>
  const pick = (candidate: unknown, fallback: string): string =>
    typeof candidate === 'string' && candidate.trim() !== '' ? candidate.trim() : fallback
  return {
    dataRoot: pick(value.dataRoot, DEFAULT_REPORT_CONFIG.dataRoot),
    briefDir: pick(value.briefDir, DEFAULT_REPORT_CONFIG.briefDir),
  }
}

export interface ReportProject {
  name: string
  purpose: string
  impl: string
  progress: string[]
  todo: string[]
  issues: string[]
}

export interface ReportFsLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<unknown>
  readText(target: unknown): Promise<string>
  listDir(target: unknown): Promise<Array<{ name?: string; path?: string }>>
}

interface ReportAgentLike {
  session: { header: { cwd: string } }
}

export interface ReportAgentsLike {
  get(id: string): ReportAgentLike | undefined
}

interface ReportRouteLike {
  kind: 'exact'
  path: string
  handler: (req: any, res: any) => Promise<void>
}

export interface ReportWebServerLike {
  register(route: ReportRouteLike): () => void
}

interface EffectContextLike {
  effect(setup: () => () => void): unknown
}

export interface ReportDependencies {
  webServer: ReportWebServerLike
  agents: ReportAgentsLike
  fs: ReportFsLike
  ensureDirectories(cwd: string, sessionId: string, config: ReportConfig): Promise<void>
  config?: ReportConfig
}

/** Parse the brief skill's stable markdown contract. */
export function parseBrief(text: string): ReportProject[] {
  const projects: ReportProject[] = []
  const lines = String(text || '').split('\n')
  let current: ReportProject | undefined
  let mode: 'progress' | 'todo' | 'issues' | '' = ''
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)/)
    if (heading?.[1] !== undefined) {
      if (current !== undefined) projects.push(current)
      current = { name: heading[1].trim(), purpose: '', impl: '', progress: [], todo: [], issues: [] }
      mode = ''
      continue
    }
    if (current === undefined) continue
    const trimmed = line.trim()
    if (trimmed === '') continue
    let match = trimmed.match(/^[-*]\s*作用[:：]\s*(.*)/)
    if (match?.[1] !== undefined) { current.purpose = match[1].trim(); continue }
    match = trimmed.match(/^[-*]\s*实现[:：]\s*(.*)/)
    if (match?.[1] !== undefined) { current.impl = match[1].trim(); continue }
    if (/^[-*]?\s*今日进度\s*[:：]/.test(trimmed)) { mode = 'progress'; continue }
    if (/^[-*]?\s*待办\s*[:：]/.test(trimmed)) { mode = 'todo'; continue }
    if (/^[-*]?\s*问题\s*[:：]/.test(trimmed)) { mode = 'issues'; continue }
    match = trimmed.match(/^(?:\d+[.、)]|[-*])\s*(.*)/)
    const item = match?.[1]?.trim()
    if (item === undefined) continue
    if (mode === 'progress') current.progress.push(item)
    else if (mode === 'todo') current.todo.push(item)
    else if (mode === 'issues') current.issues.push(item)
  }
  if (current !== undefined) projects.push(current)
  return projects
}

export function pickDailyDate(allDates: string[], today: string): { date: string; fallbackFrom: string } {
  if (allDates.includes(today)) return { date: today, fallbackFrom: '' }
  const latest = allDates.at(-1) ?? ''
  return { date: latest, fallbackFrom: latest === '' ? '' : today }
}

export function pickMonth(allDates: string[], currentMonth: string): { month: string; fallbackMonth: string; dates: string[] } {
  const inMonth = allDates.filter((date) => date.startsWith(currentMonth))
  if (inMonth.length > 0) return { month: currentMonth, fallbackMonth: '', dates: inMonth }
  const latest = allDates.at(-1)
  if (latest === undefined) return { month: currentMonth, fallbackMonth: '', dates: [] }
  const month = latest.slice(0, 7)
  return { month, fallbackMonth: month, dates: allDates.filter((date) => date.startsWith(month)) }
}

export function toMarkdown(data: any, view: 'daily' | 'monthly'): string {
  const lines: string[] = []
  if (view === 'monthly') {
    lines.push(`# 月度归纳 ${String(data.month ?? '')}`, '', '## 按日栏式', '')
    lines.push('| 日期 | 项目 | 进度 | 待办 | 问题 |', '|---|---|---|---|---|')
    for (const day of data.days ?? []) {
      lines.push(`| ${tableCell(day.date)} | ${tableCell((day.projects ?? []).join('、'))} | ${tableCell((day.progress ?? []).join('；'))} | ${tableCell((day.todo ?? []).join('；'))} | ${tableCell((day.issues ?? []).join('；'))} |`)
    }
    lines.push('', '## 跨日项目汇总')
    for (const project of data.projects ?? []) {
      lines.push('', `### ${String(project.name ?? '')}`)
      if (project.purpose) lines.push(`- 作用：${String(project.purpose)}`)
      if (project.impl) lines.push(`- 实现：${String(project.impl)}`)
      appendItems(lines, '累计进度', project.progress, '（暂无）')
      appendItems(lines, '待办', project.todo, '（无）')
      appendItems(lines, '问题', project.issues, '（无）')
    }
  } else {
    lines.push(`# 每日简报 ${String(data.date ?? '')}`, '')
    if ((data.projects ?? []).length === 0) {
      lines.push(`（无记录，按 brief skill 维护 reporter/brief/${String(data.date ?? '')}.md）`)
    }
    for (const [index, project] of (data.projects ?? []).entries()) {
      lines.push('', `${index + 1}、${String(project.name ?? '')}`)
      if (project.purpose) lines.push(`  作用：${String(project.purpose)}`)
      if (project.impl) lines.push(`  实现：${String(project.impl)}`)
      appendItems(lines, '今日进度', project.progress, '（暂无）', '  ')
      appendItems(lines, '待办', project.todo, '（无）', '  ')
      appendItems(lines, '问题', project.issues, '（无）', '  ')
    }
  }
  return lines.join('\n')
}

function tableCell(value: unknown): string {
  return String(value ?? '').replaceAll('|', '&#124;').replace(/\r?\n/g, '<br>')
}

function appendItems(lines: string[], label: string, values: string[] | undefined, empty: string, prefix = '- '): void {
  lines.push(`${prefix}${label}：`)
  const items = values ?? []
  if (items.length === 0) lines.push(`${prefix}${empty}`)
  else items.forEach((item, index) => lines.push(`${prefix}${index + 1}、${item}`))
}

function localDateKey(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function extractDate(text: string): string {
  return String(text || '').match(/^---\s*\ndate:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
}

function statsOf(projects: ReportProject[]) {
  return {
    projects: projects.length,
    progress: projects.reduce((sum, project) => sum + project.progress.length, 0),
    todo: projects.reduce((sum, project) => sum + project.todo.length, 0),
    issues: projects.reduce((sum, project) => sum + project.issues.length, 0),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Register `/api/report` as part of the manager package's host activation. */
export function registerReportApi(ctx: EffectContextLike, deps: ReportDependencies): void {
  const { webServer, agents, fs, ensureDirectories } = deps
  const config = deps.config ?? DEFAULT_REPORT_CONFIG

  function cwdOf(sessionId: unknown): string {
    if (typeof sessionId !== 'string') return ''
    return agents.get(sessionId)?.session.header.cwd ?? ''
  }

  async function readBrief(cwd: string, date: string) {
    const relativePath = `${config.dataRoot}/${config.briefDir}/${date}.md`
    const text = await fs.readText(await fs.resolve(relativePath, { cwd }))
    return { path: relativePath, date: extractDate(text) || date, projects: parseBrief(text) }
  }

  async function listBriefDates(cwd: string): Promise<string[]> {
    const target = await fs.resolve(`${config.dataRoot}/${config.briefDir}`, { cwd })
    let entries: Array<{ name?: string; path?: string }>
    try {
      entries = await fs.listDir(target)
    } catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    return entries.flatMap((entry) => {
      const match = String(entry.name ?? entry.path ?? '').match(/(\d{4}-\d{2}-\d{2})\.md$/)
      return match?.[1] === undefined ? [] : [match[1]]
    }).sort()
  }

  async function generateDaily(args: any) {
    const cwd = cwdOf(args?.sessionId)
    const today = localDateKey()
    const emptyStats = { projects: 0, progress: 0, todo: 0, issues: 0 }
    const source = `${config.dataRoot}/${config.briefDir}/`
    if (cwd === '') return { date: today, projects: [], stats: emptyStats, source, lastError: '无法确定工作区目录' }
    try {
      const pick = pickDailyDate(await listBriefDates(cwd), today)
      if (pick.date === '') return { date: today, projects: [], stats: emptyStats, source, lastError: '' }
      const result = await readBrief(cwd, pick.date)
      return { date: result.date, projects: result.projects, stats: statsOf(result.projects), source: result.path, lastError: '', fallbackFrom: pick.fallbackFrom }
    } catch (error) {
      return { date: today, projects: [], stats: emptyStats, source, lastError: errorMessage(error) }
    }
  }

  async function generateMonthly(args: any) {
    const cwd = cwdOf(args?.sessionId)
    const currentMonth = localDateKey().slice(0, 7)
    const source = `${config.dataRoot}/${config.briefDir}/`
    if (cwd === '') return { month: currentMonth, days: [], projects: [], source, lastError: '无法确定工作区目录', fallbackMonth: '' }
    let dates: string[] = []
    try {
      dates = await listBriefDates(cwd)
    } catch (error) {
      return { month: currentMonth, days: [], projects: [], source, lastError: errorMessage(error), fallbackMonth: '' }
    }
    const pick = pickMonth(dates, currentMonth)
    const days: Array<{ date: string; projects: string[]; progress: string[]; todo: string[]; issues: string[] }> = []
    const projects = new Map<string, ReportProject>()
    const skipped: string[] = []
    for (const date of pick.dates) {
      try {
        const result = await readBrief(cwd, date)
        days.push({
          date,
          projects: result.projects.map((project) => project.name),
          progress: result.projects.flatMap((project) => project.progress),
          todo: result.projects.flatMap((project) => project.todo),
          issues: result.projects.flatMap((project) => project.issues),
        })
        for (const project of result.projects) {
          const aggregate = projects.get(project.name) ?? { name: project.name, purpose: project.purpose, impl: project.impl, progress: [], todo: [], issues: [] }
          if (aggregate.purpose === '' && project.purpose !== '') aggregate.purpose = project.purpose
          if (aggregate.impl === '' && project.impl !== '') aggregate.impl = project.impl
          aggregate.progress.push(...project.progress)
          aggregate.todo.push(...project.todo)
          aggregate.issues.push(...project.issues)
          projects.set(project.name, aggregate)
        }
      } catch {
        skipped.push(date)
      }
    }
    return {
      month: pick.month,
      days,
      projects: [...projects.values()],
      source,
      lastError: skipped.length === 0 ? '' : `以下简报读取失败：${skipped.join('、')}`,
      fallbackMonth: pick.fallbackMonth,
    }
  }

  const handlers: Record<string, (args: any) => Promise<unknown>> = {
    generateDaily,
    generateMonthly,
  }

  const routeHandler = createRpcRoute({
    handlers,
    before: async (args) => {
      if (typeof args?.sessionId !== 'string') return
      const cwd = cwdOf(args.sessionId)
      if (cwd !== '') await ensureDirectories(cwd, args.sessionId, config)
    },
  })

  ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/report', handler: routeHandler }))
}
