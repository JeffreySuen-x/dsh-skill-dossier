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

/** 当周（周一~周日）的 7 个日期；今天不在有数据的周里就回退到最近一个有数据的周。 */
export function pickWeek(allDates: string[], today: string): { start: string; end: string; dates: string[]; fallbackFrom: string } {
  const week = (day: string): string[] => {
    const base = new Date(`${day}T00:00:00`)
    const weekday = (base.getDay() + 6) % 7 // 周一=0
    const start = new Date(base)
    start.setDate(base.getDate() - weekday)
    return Array.from({ length: 7 }, (_, offset) => {
      const cursor = new Date(start)
      cursor.setDate(start.getDate() + offset)
      return `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    })
  }
  const current = week(today)
  if (allDates.some((date) => current.includes(date))) {
    return { start: current[0]!, end: current[6]!, dates: current, fallbackFrom: '' }
  }
  const latest = allDates.at(-1)
  if (latest === undefined) return { start: current[0]!, end: current[6]!, dates: current, fallbackFrom: '' }
  const fallback = week(latest)
  return { start: fallback[0]!, end: fallback[6]!, dates: fallback, fallbackFrom: today }
}

export function pickMonth(allDates: string[], currentMonth: string): { month: string; fallbackMonth: string; dates: string[] } {
  const inMonth = allDates.filter((date) => date.startsWith(currentMonth))
  if (inMonth.length > 0) return { month: currentMonth, fallbackMonth: '', dates: inMonth }
  const latest = allDates.at(-1)
  if (latest === undefined) return { month: currentMonth, fallbackMonth: '', dates: [] }
  const month = latest.slice(0, 7)
  return { month, fallbackMonth: month, dates: allDates.filter((date) => date.startsWith(month)) }
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

function isMissingFile(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
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

  /** 区间内每个项目的现状（进度只保留最新一句，待办/难点取最后一天看到的）。 */
  interface RangeProject {
    name: string
    purpose: string
    progress: string
    todo: string[]
    issues: string[]
    days: string[]
  }

  async function readRange(cwd: string, dates: string[]) {
    // 每天带项目名 + 当天的进展条数：面板据此画 GitHub 式的深浅格。
    const days: Array<{ date: string; projects: Array<{ name: string; count: number }> }> = []
    const projects = new Map<string, RangeProject>()
    const missing: string[] = []
    for (const date of dates) {
      let result: Awaited<ReturnType<typeof readBrief>>
      try {
        result = await readBrief(cwd, date)
      } catch (error) {
        // 区间里的日历日是「格子」，不是「必须有文件」：那天没写简报就是空白。
        // 只有真的读不了（权限、坏文件、IO）才算失败。
        if (!isMissingFile(error)) missing.push(date)
        continue
      }
      days.push({
        date,
        projects: result.projects.map((project) => ({ name: project.name, count: project.progress.length })),
      })
      for (const project of result.projects) {
        const aggregate = projects.get(project.name)
          ?? { name: project.name, purpose: '', progress: '', todo: [], issues: [], days: [] }
        if (aggregate.purpose === '' && project.purpose !== '') aggregate.purpose = project.purpose
        const latest = project.progress.at(-1)
        if (latest !== undefined) aggregate.progress = latest
        aggregate.todo = project.todo
        aggregate.issues = project.issues
        aggregate.days.push(date)
        projects.set(project.name, aggregate)
      }
    }
    return { days, projects: [...projects.values()], missing }
  }

  async function generateDaily(args: any) {
    const cwd = cwdOf(args?.sessionId)
    const today = localDateKey()
    const emptyStats = { projects: 0, progress: 0, todo: 0, issues: 0 }
    const source = `${config.dataRoot}/${config.briefDir}/`
    if (cwd === '') return { scope: 'daily', date: today, projects: [], stats: emptyStats, source, lastError: '无法确定工作区目录' }
    try {
      const pick = pickDailyDate(await listBriefDates(cwd), today)
      if (pick.date === '') return { scope: 'daily', date: today, projects: [], stats: emptyStats, source, lastError: '' }
      const result = await readBrief(cwd, pick.date)
      return {
        scope: 'daily',
        date: result.date,
        projects: result.projects,
        stats: statsOf(result.projects),
        source: result.path,
        lastError: '',
        fallbackFrom: pick.fallbackFrom,
      }
    } catch (error) {
      return { scope: 'daily', date: today, projects: [], stats: emptyStats, source, lastError: errorMessage(error) }
    }
  }

  /** 周报 / 月报共用：给出区间内每天都列出项目，供甘特图与现状卡共用。 */
  async function generateRange(args: any, scope: 'weekly' | 'monthly') {
    const cwd = cwdOf(args?.sessionId)
    const source = `${config.dataRoot}/${config.briefDir}/`
    const today = localDateKey()
    const empty = { scope, label: '', start: today, end: today, dates: [], days: [], projects: [], source, lastError: '' }
    if (cwd === '') return { ...empty, lastError: '无法确定工作区目录' }
    let allDates: string[]
    try {
      allDates = await listBriefDates(cwd)
    } catch (error) {
      return { ...empty, lastError: errorMessage(error) }
    }
    if (allDates.length === 0) return { ...empty, dates: [], lastError: '' }

    let dates: string[]
    let label: string
    let fallbackFrom = ''
    let start = ''
    let end = ''
    if (scope === 'weekly') {
      const pick = pickWeek(allDates, today)
      // 未来的日子不画：那不是「没记录」，是「还没到」。
      dates = pick.dates.filter((day) => day <= today)
      start = dates[0] ?? pick.start
      end = dates.at(-1) ?? pick.end
      fallbackFrom = pick.fallbackFrom
      label = `${start} ~ ${end}`
    } else {
      const pick = pickMonth(allDates, today.slice(0, 7))
      const lastDay = new Date(Number(pick.month.slice(0, 4)), Number(pick.month.slice(5, 7)), 0).getDate()
      dates = Array.from({ length: lastDay }, (_, index) => `${pick.month}-${String(index + 1).padStart(2, '0')}`)
        .filter((day) => day <= today)
      start = dates[0] ?? `${pick.month}-01`
      end = dates.at(-1) ?? start
      fallbackFrom = pick.fallbackMonth
      label = pick.month
    }

    const range = await readRange(cwd, dates)
    return {
      scope,
      label,
      start,
      end,
      dates,
      days: range.days,
      projects: range.projects,
      source,
      lastError: range.missing.length === 0 ? '' : `以下简报读取失败：${range.missing.join('、')}`,
      fallbackFrom,
    }
  }

  const generateWeekly = (args: any) => generateRange(args, 'weekly')
  const generateMonthly = (args: any) => generateRange(args, 'monthly')

  const handlers: Record<string, (args: any) => Promise<unknown>> = {
    generateDaily,
    generateWeekly,
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
