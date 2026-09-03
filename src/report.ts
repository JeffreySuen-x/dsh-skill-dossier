import { isCrossSiteRequest, readJsonBody, respondJson } from './http.ts'

const MAX_BODY_BYTES = 1024 * 1024
const DATA_ROOT = 'reporter'

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
  writeText(target: unknown, content: string, encoding?: unknown, options?: unknown, policy?: unknown): Promise<unknown>
}

interface ReportAgentLike {
  session: { header: { cwd: string } }
  followup(message: unknown): void
}

export interface ReportAgentsLike {
  get(id: string): ReportAgentLike | undefined
}

export interface ReportSandboxPolicyLike {
  resolve(request?: { session?: unknown }): unknown
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
  sandboxPolicy: ReportSandboxPolicyLike
  ensureDirectories(cwd: string): Promise<void>
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
      lines.push(`| ${String(day.date ?? '')} | ${(day.projects ?? []).join('、')} | ${(day.progress ?? []).join('；')} | ${(day.todo ?? []).join('；')} | ${(day.issues ?? []).join('；')} |`)
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

/** Register `/api/report` as part of the manager package's host activation. */
export function registerReportApi(ctx: EffectContextLike, deps: ReportDependencies): void {
  const { webServer, agents, fs, sandboxPolicy, ensureDirectories } = deps

  function cwdOf(sessionId: unknown): string {
    if (typeof sessionId !== 'string') return ''
    return agents.get(sessionId)?.session.header.cwd ?? ''
  }

  function policyOf(sessionId: unknown): unknown {
    const agent = typeof sessionId === 'string' ? agents.get(sessionId) : undefined
    return agent === undefined ? sandboxPolicy.resolve() : sandboxPolicy.resolve({ session: agent.session })
  }

  async function readBrief(cwd: string, date: string) {
    const relativePath = `${DATA_ROOT}/brief/${date}.md`
    const target = await fs.resolve(relativePath, { cwd })
    const text = await fs.readText(target)
    return { path: relativePath, date: extractDate(text) || date, projects: parseBrief(text) }
  }

  async function listBriefDates(cwd: string): Promise<string[]> {
    const target = await fs.resolve(`${DATA_ROOT}/brief`, { cwd })
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
    if (cwd === '') return { date: today, projects: [], stats: emptyStats, source: `${DATA_ROOT}/brief/`, lastError: '无法确定工作区目录' }
    try {
      const pick = pickDailyDate(await listBriefDates(cwd), today)
      if (pick.date === '') return { date: today, projects: [], stats: emptyStats, source: `${DATA_ROOT}/brief/`, lastError: '' }
      const result = await readBrief(cwd, pick.date)
      return { date: result.date, projects: result.projects, stats: statsOf(result.projects), source: result.path, lastError: '', fallbackFrom: pick.fallbackFrom }
    } catch (error) {
      return { date: today, projects: [], stats: emptyStats, source: `${DATA_ROOT}/brief/`, lastError: errorMessage(error) }
    }
  }

  async function generateMonthly(args: any) {
    const cwd = cwdOf(args?.sessionId)
    const currentMonth = localDateKey().slice(0, 7)
    if (cwd === '') return { month: currentMonth, days: [], projects: [], source: `${DATA_ROOT}/brief/`, lastError: '无法确定工作区目录', fallbackMonth: '' }
    let dates: string[] = []
    try {
      dates = await listBriefDates(cwd)
    } catch (error) {
      return { month: currentMonth, days: [], projects: [], source: `${DATA_ROOT}/brief/`, lastError: errorMessage(error), fallbackMonth: '' }
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
      source: `${DATA_ROOT}/brief/`,
      lastError: skipped.length === 0 ? '' : `以下简报读取失败：${skipped.join('、')}`,
      fallbackMonth: pick.fallbackMonth,
    }
  }

  async function review(args: any) {
    const sessionId = args?.sessionId
    const cwd = cwdOf(sessionId)
    if (cwd === '' || typeof sessionId !== 'string') return { ok: false, error: '无法确定工作区目录' }
    const agent = agents.get(sessionId)
    if (agent === undefined) return { ok: false, error: '找不到对应 agent（会话可能已结束）' }
    await ensureDirectories(cwd)
    const date = localDateKey()
    const prompt = [
      '【复盘任务】请对 reporter/brief/ 下所有简报做一次整合复盘：',
      '1. 读取 reporter/brief/ 目录下所有 YYYY-MM-DD.md 文件。',
      '2. 按「结构化观察」提炼跨项目的踩坑、决策、可复用知识点（每条带发生日期与来源项目）。',
      '3. 按「周期复盘」聚合：完成了什么、关键收获、下一步、涌现主题、未记录到的成就。',
      `4. 用 markdown 写成复盘文件，保存到 reporter/Review/${date}.md（目录不存在则创建）。`,
      '完成后简要说明复盘文件已写入的位置。',
    ].join('\n')
    try {
      agent.followup({
        id: `dsh-report-review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: 'dsh-skill-manager' },
      })
      return { ok: true, message: `已触发复盘：agent 将读取所有 brief 并写入 reporter/Review/${date}.md` }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  async function exportReport(args: any) {
    const cwd = cwdOf(args?.sessionId)
    if (cwd === '') return { ok: false, error: '无法确定工作区目录' }
    await ensureDirectories(cwd)
    const view: 'daily' | 'monthly' = args?.view === 'monthly' ? 'monthly' : 'daily'
    const data: any = view === 'monthly' ? await generateMonthly(args) : await generateDaily(args)
    if (typeof data.lastError === 'string' && data.lastError !== '') return { ok: false, error: data.lastError }
    const dataKey = view === 'monthly' ? data.month : data.date
    const base = `report-${view}-${dataKey}`
    const jsonPath = `${DATA_ROOT}/export/${base}.json`
    const markdownPath = `${DATA_ROOT}/export/${base}.md`
    try {
      const policy = policyOf(args?.sessionId)
      await fs.writeText(await fs.resolve(jsonPath, { cwd }), JSON.stringify(data, null, 2), undefined, undefined, policy)
      await fs.writeText(await fs.resolve(markdownPath, { cwd }), toMarkdown(data, view), undefined, undefined, policy)
      return { ok: true, jsonPath, mdPath: markdownPath }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  const handlers: Record<string, (args: any) => Promise<unknown>> = {
    generateDaily,
    generateMonthly,
    review,
    export: exportReport,
  }

  const routeHandler = async (req: any, res: any): Promise<void> => {
    try {
      if (req.method !== 'POST') { respondJson(res, 405, { error: 'method not allowed' }); return }
      if (isCrossSiteRequest(req)) { respondJson(res, 403, { error: '跨站请求被拒绝' }); return }
      let body: any
      try {
        body = await readJsonBody(req, MAX_BODY_BYTES)
      } catch (error) {
        respondJson(res, 400, { error: `请求体无效：${errorMessage(error)}` })
        return
      }
      const method = body?.method
      if (typeof method !== 'string') { respondJson(res, 400, { error: '缺少 method 字段' }); return }
      const handler = handlers[method]
      if (handler === undefined) { respondJson(res, 404, { error: `未知方法：${method}` }); return }
      respondJson(res, 200, await handler(body?.args))
    } catch (error) {
      respondJson(res, 500, { error: errorMessage(error) })
    }
  }

  ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/report', handler: routeHandler }))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
