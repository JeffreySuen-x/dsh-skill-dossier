/**
 * Skill 全生命周期管理（host half）。
 *
 * 数据面全部复用 host 的 `skills` 分层注册表：目录浏览、详情读取、运行时
 * 技能注册/卸载走注册表；文件夹技能的停用/重装/删除通过 shell 把条目移入
 * 与技能根同级的 skill-manager/trash（可逆），chokidar 监听器自动使目录
 * 失效。档案（方向/使用范围/能力边界/应用场景）持久化在工作区
 * `.dsh/skill-manager/index.json`。
 *
 * 浏览器半通过 `POST /api/skill-manager`（JSON { method, args }）调用；
 * 模型半通过注册进 tools 注册表的 `skill_archive` 工具写档案。
 *
 * 安全边界：所有文件操作的目标路径只来自注册表定义或本插件自己写入的
 * 档案记录，绝不接受客户端任意路径；trash 目录固定在技能根同级的
 * `skill-manager/trash` 下，重装/删除前校验路径前缀。
 */
import { realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { formatMatches, matchSkills, type SkillMatch, type SkillProfile } from './match.ts'
import { DIRECTION_LABELS, detectDirections, isDirectionLabel } from './directions.ts'
import { formatReview, reviewCandidates } from './freshness.ts'
import { formatUsage, recordUsage, skillGestures } from './usage.ts'
import { atomicReplaceCommand, fsEntryOf, isWithin, mkdirCommand, moveNoClobberCommand, removeFileCommand, removeRecursiveCommand, trashDirOf } from './files.ts'
import { isCrossSiteRequest, readJsonBody, respondJson } from './http.ts'
import { createIndexStore } from './index-store.ts'
import { registerReportApi, type ReportAgentsLike, type ReportFsLike, type ReportSandboxPolicyLike, type ReportWebServerLike } from './report.ts'

/** 与 base bundle 选择 bash/pwsh 的分支一致（process.platform === 'win32'）。 */
const IS_WINDOWS = process.platform === 'win32'

/** realpath 白名单：candidate 解析符号链接后必须仍落在 dir 的 realpath 内。
 * dir 先解析——dir 不存在（记录里的 root 被篡改）一律返回 false 拒绝；
 * candidate 不存在返回 null（已消失，由调用方决定）；其余失败返回 false。 */
export async function realpathWithin(candidate: string, dir: string): Promise<boolean | null> {
  let rd: string
  try {
    rd = await realpath(dir)
  } catch {
    return false
  }
  try {
    const rc = await realpath(candidate)
    const rel = relative(rd, rc)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  } catch (error) {
    return (error as { code?: unknown }).code === 'ENOENT' ? null : false
  }
}

export const name = 'skill-manager'

/** Hard dependencies: the row waits for these services at cold boot instead of
 * applying early and silently skipping registrations (insert rows may mount
 * before some bundle rows have activated). */
export const inject = ['skills', 'tools', 'webServer', 'agents', 'fs', 'shell', 'sandboxPolicy']

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_BODY_BYTES = 1024 * 1024

interface InvocationLike { modelInvocable: boolean; userInvocable: boolean }
interface SummaryLike {
  name: string
  description: string
  whenToUse?: string
  invocation: InvocationLike
  source: string
  provider: string
}
interface DefinitionLike extends SummaryLike {
  content: string
  path?: string
}
interface SkillsLike {
  list(options?: unknown): Promise<SummaryLike[]>
  get(name: string, options?: unknown): Promise<DefinitionLike | undefined>
  register(skill: unknown): () => void
}
interface AgentLike {
  session: { header: { cwd: string } }
  ctx: Context
}
interface AgentsLike { get(id: string): AgentLike | undefined }
interface FsLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<unknown>
  readText(target: unknown): Promise<string>
  listDir(target: unknown): Promise<Array<{ name?: string; path?: string }>>
  writeText(target: unknown, content: string, encoding?: unknown, options?: unknown, policy?: unknown): Promise<unknown>
}
interface ShellRunResultLike {
  exitCode: number | null
  sandbox?: { denied: boolean; mode: string }
  stderr?: { text?: string } | null
}
interface ShellLike {
  resolve(request: unknown): unknown
  run(spec: unknown): Promise<ShellRunResultLike>
}
interface SandboxPolicyLike {
  workspaceRoot: string
  resolve(request?: { mode?: string; session?: unknown }): unknown
}
interface ToolsLike { register(tool: unknown): () => void }
interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: unknown, res: any) => void | Promise<void>
}
interface WebServerLike { register(route: WebRouteLike): () => void }

export function apply(ctx: Context): void {
  const skills = ctx.get('skills') as SkillsLike | undefined
  const agents = ctx.get('agents') as AgentsLike | undefined
  const fs = ctx.get('fs') as FsLike | undefined
  const shell = ctx.get('shell') as ShellLike | undefined
  const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  const tools = ctx.get('tools') as ToolsLike | undefined
  const webServer = ctx.get('webServer') as WebServerLike | undefined
  if (skills === undefined || agents === undefined || fs === undefined || shell === undefined || sandboxPolicy === undefined || tools === undefined || webServer === undefined) return

  const owned = new Map<AgentLike, Map<string, () => void>>()
  const temporaryBarriers = new WeakMap<AgentLike, Promise<void>>()
  let active = true
  ctx.effect(() => () => {
    active = false
    for (const registrations of owned.values()) {
      for (const dispose of registrations.values()) dispose()
    }
    owned.clear()
  })

  function ownedBy(agent: AgentLike): Map<string, () => void> {
    const existing = owned.get(agent)
    if (existing !== undefined) return existing
    const registrations = new Map<string, () => void>()
    owned.set(agent, registrations)
    agent.ctx.effect(() => () => {
      if (owned.get(agent) === registrations) owned.delete(agent)
    })
    return registrations
  }

  function isOwned(sessionId: unknown, name: string): boolean {
    const agent = agentOf(sessionId)
    return agent !== undefined && owned.get(agent)?.has(name) === true
  }

  function enqueueTemporary<T>(agent: AgentLike, task: () => Promise<T>): Promise<T> {
    const previous = temporaryBarriers.get(agent) ?? Promise.resolve()
    const result = previous.then(task, task)
    const barrier = result.then(() => undefined, () => undefined)
    temporaryBarriers.set(agent, barrier)
    void barrier.then(() => {
      if (temporaryBarriers.get(agent) === barrier) temporaryBarriers.delete(agent)
    })
    return result
  }

  function viewOptions(sessionId: unknown) {
    if (typeof sessionId !== 'string') return {}
    const agent = agents!.get(sessionId)
    if (agent === undefined) return {}
    return { scope: agent as unknown, cwd: agent.session.header.cwd }
  }

  function agentOf(sessionId: unknown): AgentLike | undefined {
    if (typeof sessionId !== 'string') return undefined
    return agents!.get(sessionId)
  }

  function cwdOf(sessionId: unknown): string | undefined {
    return agentOf(sessionId)?.session.header.cwd
  }

  function uuid4(): string {
    let s = ''
    for (let i = 0; i < 36; i += 1) {
      if (i === 8 || i === 13 || i === 18 || i === 23) { s += '-'; continue }
      if (i === 14) { s += '4'; continue }
      if (i === 19) { s += '89ab'[Math.floor(Math.random() * 4)]; continue }
      s += '0123456789abcdef'[Math.floor(Math.random() * 16)]
    }
    return s
  }

  function userMessage(text: string): unknown {
    return {
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
      id: uuid4(),
    }
  }

  async function runShell(command: string, targetPath: string, policyOverride?: unknown): Promise<void> {
    const request: { command: string; sandboxPolicy?: unknown } = { command }
    if (policyOverride !== undefined) {
      request.sandboxPolicy = policyOverride
    } else {
      const ws = sandboxPolicy!.workspaceRoot
      const mode = ws !== undefined && isWithin(targetPath, ws) ? 'workspace-write' : 'danger-full-access'
      request.sandboxPolicy = sandboxPolicy!.resolve({ mode })
    }
    const result = await shell!.run(shell!.resolve(request))
    if (result.sandbox !== undefined && result.sandbox.denied === true) {
      throw new Error(`文件操作被沙箱拒绝（${result.sandbox.mode}）`)
    }
    if (result.exitCode !== 0) {
      const err = result.stderr !== null && result.stderr !== undefined && typeof result.stderr.text === 'string'
        ? result.stderr.text.trim()
        : ''
      throw new Error(`命令失败（exit ${String(result.exitCode)}）：${err}`)
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function rollbackMoveAfterCommitFailure(
    operationError: unknown,
    source: string,
    destination: string,
    root: string,
  ): Promise<void> {
    try {
      await runShell(moveNoClobberCommand(source, destination, IS_WINDOWS), root)
    } catch (rollbackError) {
      throw new Error(
        `索引提交失败：${errorMessage(operationError)}；文件回滚失败：${errorMessage(rollbackError)}`,
      )
    }
  }

  const indexStore = createIndexStore({
    async lockKey(cwd) {
      let canonical: string
      try {
        canonical = await realpath(cwd)
      } catch (error) {
        if ((error as { code?: unknown }).code !== 'ENOENT') throw error
        canonical = resolvePath(cwd)
      }
      return IS_WINDOWS ? canonical.toLowerCase() : canonical
    },
    async read(cwd) {
      const target = await fs.resolve(join(cwd, '.dsh', 'skill-manager', 'index.json'), { cwd })
      return fs.readText(target)
    },
    async writeAtomic(cwd, value) {
      const dir = join(cwd, '.dsh', 'skill-manager')
      const targetPath = join(dir, 'index.json')
      const temporaryPath = join(dir, `.index.json.${process.pid}-${uuid4()}.tmp`)
      await runShell(mkdirCommand(dir, IS_WINDOWS), join(cwd, '.dsh'))
      const temporaryTarget = await fs.resolve(temporaryPath, { cwd })
      try {
        await fs.writeText(temporaryTarget, value)
        await runShell(atomicReplaceCommand(temporaryPath, targetPath, IS_WINDOWS), dir)
      } catch (error) {
        try { await runShell(removeFileCommand(temporaryPath, IS_WINDOWS), dir) } catch { /* best-effort temp cleanup */ }
        throw error
      }
    },
  })

  const readIndex = (cwd: string | undefined) => indexStore.read(cwd)

  class IndexOperationRejected extends Error {
    constructor(readonly response: { ok: false; error: string }) {
      super(response.error)
    }
  }

  async function updateIndexOrReject<T>(
    cwd: string,
    mutate: (index: Awaited<ReturnType<typeof readIndex>>) => Promise<T>,
    recoverWriteFailure?: (error: unknown) => void | Promise<void>,
  ): Promise<T | { ok: false; error: string }> {
    try {
      return await indexStore.update(cwd, mutate, recoverWriteFailure)
    } catch (error) {
      if (error instanceof IndexOperationRejected) return error.response
      throw error
    }
  }

  function rejectIndexOperation(error: string): never {
    throw new IndexOperationRejected({ ok: false, error })
  }

  // ---------- 技能调用埋点（次数/频率统计） ----------

  /** 记录一次技能调用：读取 index → 折叠进 usage → 回写。 */
  function recordSkillUse(cwd: string, name: string): void {
    if (!NAME_RE.test(name)) return
    void indexStore.update(cwd, (index) => {
      recordUsage(index.usage, name, Date.now())
    }).catch(() => {
      // 埋点失败不打断技能本身；调用统计是可丢失的观察数据。
    })
  }

  if (ctx.on !== undefined) {
    // DSH 的 tools/agent 事件经声明合并注册进 cordis Events；本包未把它们纳入
    // 编译（运行时共存即可），故对 ctx.on 收窄为仅含这两个事件名的签名。
    type HostEventOn = {
      (name: 'tools/result', listener: (exec: any, result: any) => void): () => void
      (name: 'agent/inbox/claimed', listener: (payload: any) => void): () => void
    }
    const onEvent = ctx.on as unknown as HostEventOn
    // ① 模型经 skill 工具加载（tools/result 为 emit，未作用域监听器收到所有 agent 的事件）。
    onEvent('tools/result', (exec, result) => {
      if (exec?.name !== 'skill' || result?.isError === true) return
      const name = exec?.arguments?.name
      if (typeof name !== 'string' || name === '') return
      const cwd = exec?.agent?.session?.header?.cwd
      if (typeof cwd !== 'string') return
      recordSkillUse(cwd, name)
    })
    // ② 用户 /name 手势（模型工具之外的另一条调用路径）。
    onEvent('agent/inbox/claimed', (payload) => {
      const cwd = payload?.agent?.session?.header?.cwd
      if (typeof cwd !== 'string') return
      const message = payload?.message
      if (message === null || typeof message !== 'object' || message.source?.kind !== 'user') return
      const blocks = Array.isArray(message.content) ? message.content : []
      for (const block of blocks) {
        if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') continue
        for (const name of skillGestures(block.text)) recordSkillUse(cwd, name)
      }
    })
  }

  // ---------- 技能匹配（模型工具 skill_match 与浏览器 RPC match 共用） ----------

  /** 匹配结果集合。 */
  interface MatchOutcome {
    matches: SkillMatch[]
    total: number
    text: string
  }

  /**
   * 从已建档技能中按相关性选出最匹配的候选。
   * @param agent 当前会话 agent
   * @param args { query, topK?, direction? }
   * @returns 排序后的短名单与给模型看的文本
   */
  const runMatch = async (agent: AgentLike, args: any): Promise<MatchOutcome> => {
    const query = typeof args?.query === 'string' ? args.query.trim() : ''
    const cwd = agent.session.header.cwd
    const index = await readIndex(cwd)
    const profiles: SkillProfile[] = Object.values(index.skills).filter(
      (e) => typeof e.direction === 'string' && e.direction !== '',
    )
    const total = profiles.length
    if (query === '' || total === 0) {
      return {
        matches: [],
        total,
        text: total === 0
          ? '还没有任何已建档技能（.dsh/skill-manager/index.json 为空）。先用 skill_archive 工具为技能建档。'
          : '请先输入任务描述（query）。',
      }
    }
    const lookup = { scope: agent as unknown, cwd }
    let extraText = new Map<string, string>()
    try {
      const summaries = await skills.list(lookup)
      extraText = new Map(summaries.map((s) => [s.name, `${s.description} ${typeof s.whenToUse === 'string' ? s.whenToUse : ''}`]))
    } catch {
      // 注册表描述缺失不影响匹配
    }
    const rawTopK = typeof args?.topK === 'number' ? Math.trunc(args.topK) : 5
    const topK = Math.min(20, Math.max(1, Number.isFinite(rawTopK) ? rawTopK : 5))
    const direction = typeof args?.direction === 'string' && args.direction.trim() !== '' ? args.direction.trim() : undefined
    const matches = matchSkills(query, profiles, { topK, direction }, extraText)
    let text = formatMatches(matches, total, query)
    if (matches.length === 0 && direction === undefined) {
      const dirs = [...new Set(profiles.map((p) => p.direction).filter((d): d is string => typeof d === 'string' && d !== ''))]
      text += `\n当前已建档技能的方向分类：${dirs.join('、')}。可指定 direction 过滤。`
    }
    return { matches, total, text }
  }

  /**
   * 两段式路由：先用关键词命中判方向，再在命中方向内做词法检索。
   * 未命中方向时退化为全局检索并提示可选方向。
   * @param agent 当前会话 agent
   * @param args { query, topK? }
   */
  const runRoute = async (agent: AgentLike, args: any): Promise<MatchOutcome> => {
    const query = typeof args?.query === 'string' ? args.query.trim() : ''
    if (query === '') return runMatch(agent, args)
    const cwd = agent.session.header.cwd
    const index = await readIndex(cwd)
    const profiles: SkillProfile[] = Object.values(index.skills).filter(
      (e) => typeof e.direction === 'string' && e.direction !== '',
    )
    const total = profiles.length
    if (total === 0) return runMatch(agent, args)
    const lookup = { scope: agent as unknown, cwd }
    let extraText = new Map<string, string>()
    try {
      const summaries = await skills.list(lookup)
      extraText = new Map(summaries.map((s) => [s.name, `${s.description} ${typeof s.whenToUse === 'string' ? s.whenToUse : ''}`]))
    } catch {
      // 注册表描述缺失不影响匹配
    }
    const rawTopK = typeof args?.topK === 'number' ? Math.trunc(args.topK) : 5
    const topK = Math.min(20, Math.max(1, Number.isFinite(rawTopK) ? rawTopK : 5))

    const dirs = detectDirections(query)
    const scoped = dirs.length === 0 ? profiles : profiles.filter((p) => p.direction !== undefined && dirs.includes(p.direction))
    const matches = matchSkills(query, scoped, { topK }, extraText)
    let text: string
    if (dirs.length === 0) {
      text = formatMatches(matches, total, query)
      text += `\n（未命中方向关键词，已做全局检索；可指定方向：${DIRECTION_LABELS.join('、')}）`
    } else {
      text = `命中方向：${dirs.join('、')}\n\n${formatMatches(matches, scoped.length, query)}`
    }
    return { matches, total, text }
  }

  // ---------- 模型工具：skill_archive ----------

  if (tools !== undefined) {
    tools.register({
      name: 'skill_archive',
      description: '为技能写档案（方向分类、使用范围、能力边界、应用场景），持久化到工作区 .dsh/skill-manager/index.json。先读取技能内容并分析，再调用本工具落盘。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名（kebab-case）' },
          direction: { type: 'string', description: `方向分类，如：${DIRECTION_LABELS.join('/')}` },
          useScope: { type: 'string', description: '使用范围：适用于哪些任务与场景' },
          boundaries: { type: 'string', description: '能力边界：做不到什么、何时不适用' },
          scenarios: { type: 'string', description: '应用场景：典型用例' },
          notes: { type: 'string', description: '补充说明（可选）' },
          origin: { type: 'string', description: '来源标注（可选）：self=自创，external=外来下载，system=系统内置，unknown=未标注' },
        },
        required: ['name', 'direction', 'useScope', 'boundaries', 'scenarios'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        render: (_args: unknown, value: any) => [{ type: 'text', text: String(value.message ?? '') }],
      },
      async execute(args: any, exec: any): Promise<{ ok: boolean; message: string }> {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (!NAME_RE.test(name)) throw new Error(`无效的技能名：${name}`)
        const agent = exec.agent as AgentLike | undefined
        if (agent === undefined) throw new Error('无法确定当前会话')
        const cwd = agent.session.header.cwd
        const lookup = { scope: agent as unknown, cwd }
        const summary = (await skills.list(lookup)).find((s) => s.name === name)
        if (summary === undefined) throw new Error(`技能 "${name}" 不存在，请先安装或注册`)
        if (summary.source === 'bundled') throw new Error(`技能 "${name}" 是 DSH 原生技能（bundled），由 harness 自行检索，无需建档`)
        const direction = typeof args.direction === 'string' ? args.direction.trim() : ''
        const useScope = typeof args.useScope === 'string' ? args.useScope.trim() : ''
        const boundaries = typeof args.boundaries === 'string' ? args.boundaries.trim() : ''
        const scenarios = typeof args.scenarios === 'string' ? args.scenarios.trim() : ''
        if (direction === '' || useScope === '' || boundaries === '' || scenarios === '') {
          throw new Error('direction/useScope/boundaries/scenarios 均不能为空')
        }
        if (!isDirectionLabel(direction)) {
          throw new Error(`无效的方向「${direction}」。可选：${DIRECTION_LABELS.join('、')}`)
        }
        const origin: 'self' | 'external' | 'system' | 'unknown' = args.origin === 'self' || args.origin === 'external' || args.origin === 'system' || args.origin === 'unknown'
          ? args.origin
          : 'unknown'
        const definition = await skills.get(name, lookup)
        const contentHash = definition === undefined
          ? undefined
          : createHash('sha256').update(definition.content).digest('hex').slice(0, 16)
        const now = Date.now()
        await indexStore.update(cwd, (index) => {
          index.skills[name] = {
            name,
            direction,
            useScope,
            boundaries,
            scenarios,
            notes: typeof args.notes === 'string' && args.notes.trim() !== '' ? args.notes.trim() : undefined,
            origin,
            updatedAt: now,
            reviewedAt: now,
            ...(contentHash !== undefined ? { contentHash } : {}),
          }
        })
        return { ok: true, message: `已为技能 "${name}" 建档（方向：${direction}）` }
      },
    })

    tools.register({
      name: 'skill_match',
      description: '从已建档技能中找出最适合当前任务的技能。给定当前任务的一句话描述，读取工作区 .dsh/skill-manager/index.json 里的技能档案（方向/使用范围/能力边界/应用场景），按相关性返回最匹配的候选。当需要决定调用哪个 skill、或在多个技能间拿不准时使用；命中候选后再用 skill 工具加载其全文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '当前任务/目标的一句话描述（中文或英文），例如「调研某城市未来 20 年发展」「帮我写一个登录页面」' },
          topK: { type: 'integer', description: '返回最相关的候选条数，默认 5，范围 1-20' },
          direction: { type: 'string', description: `可选：只在该方向分类内匹配（${DIRECTION_LABELS.join('/')}）` },
        },
        required: ['query'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            matches: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  direction: { type: 'string' },
                  useScope: { type: 'string' },
                  scenarios: { type: 'string' },
                  score: { type: 'number' },
                  matched: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            total: { type: 'integer' },
            text: { type: 'string' },
          },
        },
        render: (_args: unknown, value: any) => [{ type: 'text', text: String(value.text ?? '') }],
      },
      async execute(args: any, exec: any): Promise<{ matches: SkillMatch[]; total: number; text: string }> {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (query === '') throw new Error('请提供 query：当前任务的一句话描述')
        const agent = exec.agent as AgentLike | undefined
        if (agent === undefined) throw new Error('无法确定当前会话')
        return runMatch(agent, args)
      },
    })

    tools.register({
      name: 'skill_route',
      description: '两段式技能路由：先用关键词命中判断任务属于哪个方向（工程代码/前端视觉/调研报告/内容写作/知识库/记忆会话/多代理编排/本地模型/元技能/命理玄学），再返回该方向内最相关的技能候选。比 skill_match 更省 token、更聚焦；命中候选后用 skill 工具加载全文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '当前任务/目标的一句话描述，例如「调研某行业前景」「写一个落地页」' },
          topK: { type: 'integer', description: '返回最相关的候选条数，默认 5，范围 1-20' },
        },
        required: ['query'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            matches: { type: 'array', items: { type: 'object', additionalProperties: true } },
            total: { type: 'integer' },
            text: { type: 'string' },
          },
        },
        render: (_args: unknown, value: any) => [{ type: 'text', text: String(value.text ?? '') }],
      },
      async execute(args: any, exec: any): Promise<{ matches: SkillMatch[]; total: number; text: string }> {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (query === '') throw new Error('请提供 query：当前任务的一句话描述')
        const agent = exec.agent as AgentLike | undefined
        if (agent === undefined) throw new Error('无法确定当前会话')
        return runRoute(agent, args)
      },
    })

    tools.register({
      name: 'skill_usage',
      description: '查看技能被调用的次数与频率统计（由本插件自动记录：模型经 skill 工具加载、或用户用 /name 手势调用都会计数）。省略 name 返回所有被调用过的技能（按次数降序）；给定 name 只看该技能的明细。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '可选：只看某个技能（kebab-case）；省略则返回所有被调用过的技能' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string' },
          },
        },
        render: (_args: unknown, value: any) => [{ type: 'text', text: String(value.text ?? '') }],
      },
      async execute(args: any, exec: any): Promise<{ text: string }> {
        const agent = exec.agent as AgentLike | undefined
        if (agent === undefined) throw new Error('无法确定当前会话')
        const index = await readIndex(agent.session.header.cwd)
        const name = typeof args?.name === 'string' && args.name.trim() !== '' ? args.name.trim() : undefined
        return { text: formatUsage(index.usage, name, Date.now()) }
      },
    })

    tools.register({
      name: 'skill_review',
      description: '找出待复审的技能（保鲜信号）：易变方向 + 长期未用 + 从未/久未复审，按优先级排序。用于决定「哪个 skill 该跑一轮 darwin-skill 评测/更新」。',
      parameters: {
        type: 'object',
        properties: {
          topK: { type: 'integer', description: '返回前几条待复审，默认 10' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string' },
          },
        },
        render: (_args: unknown, value: any) => [{ type: 'text', text: String(value.text ?? '') }],
      },
      async execute(args: any, exec: any): Promise<{ text: string }> {
        const agent = exec.agent as AgentLike | undefined
        if (agent === undefined) throw new Error('无法确定当前会话')
        const index = await readIndex(agent.session.header.cwd)
        const rawTopK = typeof args?.topK === 'number' ? Math.trunc(args.topK) : 10
        const topK = Math.min(50, Math.max(1, Number.isFinite(rawTopK) ? rawTopK : 10))
        const entries = reviewCandidates(index.skills, index.usage, Date.now(), topK)
        return { text: formatReview(entries, Object.keys(index.skills).length) }
      },
    })

    tools.register({
      name: 'skill_eval',
      description: '触发对某个技能的有效性评测（对话框外）：加载 darwin-skill，用「带 skill vs 不带 skill」对比 + 中立 judge 评测该技能，然后用 record_eval 工具把结论写回档案。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '要评测的技能名（kebab-case）' },
        },
        required: ['name'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        render: (_args: unknown, value: any) => [{ type: 'text', text: String(value.message ?? '') }],
      },
      async execute(args: any, exec: any): Promise<{ ok: boolean; message: string }> {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (!NAME_RE.test(name)) throw new Error(`无效的技能名：${name}`)
        const agent = exec.agent as (AgentLike & { followup(message: unknown): void }) | undefined
        if (agent === undefined) throw new Error('无法确定当前会话')
        const lookup = { scope: agent as unknown, cwd: agent.session.header.cwd }
        const summary = (await skills.list(lookup)).find((s) => s.name === name)
        if (summary === undefined) throw new Error(`技能 "${name}" 不存在`)
        agent.followup(userMessage(
          `请加载 darwin-skill，对技能「${name}」做一轮有效性评测：用「带 skill vs 不带 skill」跑同一基准任务、让中立 judge 打分，得出 score(0-10) 与 delta 描述，然后用 record_eval 工具把结论写回。`,
        ))
        return { ok: true, message: `已触发对技能 "${name}" 的评测（对话框外执行）` }
      },
    })

    tools.register({
      name: 'record_eval',
      description: '把 darwin-skill 的评测结论写回技能档案：score(0-10)、baselineDelta(用 vs 不用的差异描述)、conclusion(有效/无效/待评测)。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名（kebab-case）' },
          score: { type: 'number', description: '评测得分 0-10' },
          baselineDelta: { type: 'string', description: '用 skill vs 不用的差异（一句话）' },
          conclusion: { type: 'string', description: '有效 / 无效 / 待评测' },
        },
        required: ['name', 'conclusion'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        render: (_args: unknown, value: any) => [{ type: 'text', text: String(value.message ?? '') }],
      },
      async execute(args: any, exec: any): Promise<{ ok: boolean; message: string }> {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (!NAME_RE.test(name)) throw new Error(`无效的技能名：${name}`)
        const agent = exec.agent as AgentLike | undefined
        if (agent === undefined) throw new Error('无法确定当前会话')
        const conclusion: '有效' | '无效' | '待评测' = args.conclusion === '有效' || args.conclusion === '无效' || args.conclusion === '待评测'
          ? args.conclusion
          : '待评测'
        await indexStore.update(agent.session.header.cwd, (index) => {
          const entry = index.skills[name]
          if (entry === null || typeof entry !== 'object') throw new Error(`技能 "${name}" 未建档`)
          entry.evaluation = {
            score: typeof args.score === 'number' && Number.isFinite(args.score) ? args.score : null,
            judgedAt: Date.now(),
            baselineDelta: typeof args.baselineDelta === 'string' && args.baselineDelta.trim() !== '' ? args.baselineDelta.trim() : null,
            conclusion,
          }
        })
        return { ok: true, message: `已记录技能 "${name}" 的评测结论：${conclusion}` }
      },
    })
  }

  // ---------- HTTP RPC（浏览器半调用） ----------

  const handlers: Record<string, (args: any) => Promise<unknown>> = {
    async list(args) {
      const sessionId = args?.sessionId
      const summaries = await skills.list(viewOptions(sessionId))
      const index = await readIndex(cwdOf(sessionId))
      return {
        skills: summaries.map((s) => ({
          name: s.name,
          description: s.description,
          whenToUse: typeof s.whenToUse === 'string' ? s.whenToUse : null,
          modelInvocable: s.invocation.modelInvocable === true,
          userInvocable: s.invocation.userInvocable === true,
          source: s.source,
          provider: s.provider,
          owned: isOwned(sessionId, s.name),
        })),
        index,
      }
    },

    async get(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return null
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const skill = await skills.get(args.name, viewOptions(sessionId))
      if (skill === undefined) return null
      const index = await readIndex(cwdOf(sessionId))
      const profile = Object.prototype.hasOwnProperty.call(index.skills, skill.name) ? index.skills[skill.name] : null
      return {
        name: skill.name,
        description: skill.description,
        whenToUse: typeof skill.whenToUse === 'string' ? skill.whenToUse : null,
        content: skill.content,
        source: skill.source,
        provider: skill.provider,
        path: typeof skill.path === 'string' ? skill.path : null,
        modelInvocable: skill.invocation.modelInvocable === true,
        userInvocable: skill.invocation.userInvocable === true,
        owned: isOwned(sessionId, skill.name),
        profile,
      }
    },

    async register(args) {
      if (args === null || typeof args !== 'object') return { ok: false, error: '参数无效' }
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      const description = typeof args.description === 'string' ? args.description.trim() : ''
      const content = typeof args.content === 'string' ? args.content : ''
      if (!NAME_RE.test(name)) return { ok: false, error: '名称必须是 kebab-case（小写字母、数字、连字符）' }
      if (description === '') return { ok: false, error: '描述不能为空' }
      if (content.trim() === '') return { ok: false, error: '内容不能为空' }
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const agent = agentOf(sessionId)
      if (agent === undefined) return { ok: false, error: '当前会话没有活跃的 agent' }
      return enqueueTemporary(agent, async () => {
        if (!active) return { ok: false, error: '插件或当前会话已停止' }
        const scopedSkills = agent.ctx.get('skills') as SkillsLike | undefined
        if (scopedSkills === undefined) return { ok: false, error: '当前会话的 skills 服务不可用' }
        const registrations = ownedBy(agent)
        const existing = (await skills.list({ scope: agent as unknown, cwd: agent.session.header.cwd })).some((s) => s.name === name)
        if (!active || agentOf(sessionId) !== agent || owned.get(agent) !== registrations) {
          return { ok: false, error: '插件或当前会话已停止' }
        }
        if (existing && !registrations.has(name)) return { ok: false, error: `同名技能 "${name}" 已存在` }
        const current = registrations.get(name)
        if (current !== undefined) {
          current()
          registrations.delete(name)
        }
        const dispose = scopedSkills.register({
          name,
          description,
          ...(typeof args.whenToUse === 'string' && args.whenToUse.trim() !== '' ? { whenToUse: args.whenToUse.trim() } : {}),
          content,
          source: 'custom',
          invocation: {
            modelInvocable: args.modelInvocable !== false,
            userInvocable: args.userInvocable !== false,
          },
        })
        registrations.set(name, dispose)
        return { ok: true }
      })
    },

    async unregister(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const agent = agentOf(sessionId)
      if (agent === undefined) return { ok: false, error: '当前会话没有活跃的 agent' }
      return enqueueTemporary(agent, async () => {
        if (!active || agentOf(sessionId) !== agent) return { ok: false, error: '插件或当前会话已停止' }
        const registrations = owned.get(agent)
        const dispose = registrations?.get(args.name)
        if (dispose === undefined) return { ok: false, error: '该技能不是本会话注册的临时技能' }
        dispose()
        registrations!.delete(args.name)
        return { ok: true }
      })
    },

    async invoke(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const name = args.name
      if (!NAME_RE.test(name)) return { ok: false, error: '无效的技能名' }
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const agent = agentOf(sessionId) as (AgentLike & { followup(message: unknown): void }) | undefined
      if (agent === undefined) return { ok: false, error: '当前会话没有活跃的 agent' }
      const skill = await skills.get(name, viewOptions(sessionId))
      if (skill === undefined) return { ok: false, error: `技能 "${name}" 不存在` }
      if (skill.invocation.userInvocable !== true) return { ok: false, error: '该技能不允许用户显式调用' }
      agent.followup(userMessage(`/${name}`))
      return { ok: true }
    },

    async match(args) {
      const sessionId = typeof args?.sessionId === 'string' ? args.sessionId : undefined
      const agent = agentOf(sessionId)
      if (agent === undefined) return { ok: false, error: '当前会话没有活跃的 agent' }
      const outcome = await runMatch(agent, args)
      return { ok: true, ...outcome }
    },

    async ingest(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const name = args.name
      if (!NAME_RE.test(name)) return { ok: false, error: '无效的技能名' }
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const agent = agentOf(sessionId) as (AgentLike & { followup(message: unknown): void }) | undefined
      if (agent === undefined) return { ok: false, error: '当前会话没有活跃的 agent' }
      const skill = await skills.get(name, viewOptions(sessionId))
      if (skill === undefined) return { ok: false, error: `技能 "${name}" 不存在` }
      const source = typeof skill.path === 'string'
        ? `先读取技能内容（路径：${skill.path}），`
        : '先用 skill 工具加载该技能，'
      const prompt = `请为技能「${name}」建档：${source}`
        + `分析它属于哪个方向（候选：${DIRECTION_LABELS.join('、')}），`
        + '然后调用 skill_archive 工具填写：方向 direction、使用范围 useScope、能力边界 boundaries、应用场景 scenarios。'
      agent.followup(userMessage(prompt))
      return { ok: true }
    },

    async uninstall(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const name = args.name
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const skill = await skills.get(name, viewOptions(sessionId))
      if (skill === undefined) return { ok: false, error: `技能 "${name}" 不存在` }
      const entryInfo = fsEntryOf(skill)
      if (entryInfo === undefined) return { ok: false, error: '该技能不是文件系统技能，无法停用' }
      const cwd = cwdOf(sessionId)
      if (cwd === undefined) return { ok: false, error: '无法确定当前工作目录' }
      const trashDir = trashDirOf(entryInfo.root)
      const removedAt = Date.now()
      const trashedPath = join(trashDir, `${name}-${removedAt}`)
      let moved = false
      await indexStore.update(
        cwd,
        async (index) => {
          await runShell(mkdirCommand(trashDir, IS_WINDOWS), entryInfo.root)
          await runShell(moveNoClobberCommand(entryInfo.entry, trashedPath, IS_WINDOWS), entryInfo.root)
          moved = true
          index.trash[name] = { name, originalPath: entryInfo.entry, trashedPath, root: entryInfo.root, removedAt }
        },
        async (error) => {
          if (moved) await rollbackMoveAfterCommitFailure(error, trashedPath, entryInfo.entry, entryInfo.root)
        },
      )
      return { ok: true }
    },

    async reinstall(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const name = args.name
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const cwd = cwdOf(sessionId)
      if (cwd === undefined) return { ok: false, error: '无法确定当前工作目录' }
      let rollback: { source: string; destination: string; root: string } | undefined
      return updateIndexOrReject(
        cwd,
        async (index) => {
          const record = index.trash[name]
          if (record === null || typeof record !== 'object') rejectIndexOperation('未找到该技能的停用记录')
          const { trashedPath, originalPath, root } = record
          if (typeof trashedPath !== 'string' || typeof originalPath !== 'string' || typeof root !== 'string' || trashedPath === '' || originalPath === '' || root === '') {
            rejectIndexOperation('停用记录损坏')
          }
          if (await realpathWithin(trashedPath, trashDirOf(root)) !== true) rejectIndexOperation('停用记录路径异常，拒绝操作')
          if (!isWithin(originalPath, root)) rejectIndexOperation('停用记录路径异常，拒绝操作')
          await runShell(moveNoClobberCommand(trashedPath, originalPath, IS_WINDOWS), root)
          rollback = { source: originalPath, destination: trashedPath, root }
          delete index.trash[name]
          return { ok: true }
        },
        async (error) => {
          if (rollback !== undefined) {
            await rollbackMoveAfterCommitFailure(error, rollback.source, rollback.destination, rollback.root)
          }
        },
      )
    },

    async deleteTrash(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const name = args.name
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const cwd = cwdOf(sessionId)
      if (cwd === undefined) return { ok: false, error: '无法确定当前工作目录' }
      return updateIndexOrReject(cwd, async (index) => {
        const record = index.trash[name]
        if (record === null || typeof record !== 'object') rejectIndexOperation('未找到该技能的停用记录')
        const { trashedPath, root } = record
        if (typeof trashedPath !== 'string' || typeof root !== 'string' || trashedPath === '' || root === '') {
          rejectIndexOperation('停用记录损坏')
        }
        if (await realpathWithin(trashedPath, trashDirOf(root)) === false) rejectIndexOperation('停用记录路径异常，拒绝操作')
        await runShell(removeRecursiveCommand(trashedPath, IS_WINDOWS), root)
        delete index.trash[name]
        return { ok: true }
      })
    },

    async setOrigin(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const name = args.name
      if (!NAME_RE.test(name)) return { ok: false, error: '无效的技能名' }
      const origin = args.origin
      if (origin !== 'self' && origin !== 'external' && origin !== 'system' && origin !== 'unknown') {
        return { ok: false, error: 'origin 必须是 self/external/system/unknown' }
      }
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const cwd = cwdOf(sessionId)
      if (cwd === undefined) return { ok: false, error: '无法确定当前工作目录' }
      await indexStore.update(cwd, (index) => {
        const entry = index.skills[name]
        if (entry === null || typeof entry !== 'object') {
          index.skills[name] = { name, origin, updatedAt: Date.now() }
        } else {
          entry.origin = origin
          entry.updatedAt = Date.now()
        }
      })
      return { ok: true }
    },
  }

  const routeHandler = async (req: any, res: any): Promise<void> => {
    try {
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (isCrossSiteRequest(req)) {
        respondJson(res, 403, { error: '跨站请求被拒绝' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(req, MAX_BODY_BYTES)
      } catch (error) {
        respondJson(res, 400, { error: `请求体无效：${String(error)}` })
        return
      }
      const { method, args } = (body ?? {}) as { method?: unknown; args?: unknown }
      if (typeof method !== 'string') {
        respondJson(res, 400, { error: '缺少 method 字段' })
        return
      }
      const handler = handlers[method]
      if (handler === undefined) {
        respondJson(res, 404, { error: `未知方法：${method}` })
        return
      }
      const result = await handler(args)
      respondJson(res, 200, result)
    } catch (error) {
      respondJson(res, 500, { error: String(error) })
    }
  }

  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/skill-manager', handler: routeHandler }))
  }
  if (webServer !== undefined && agents !== undefined && fs !== undefined && sandboxPolicy !== undefined) {
    registerReportApi(ctx, {
      webServer: webServer as unknown as ReportWebServerLike,
      agents: agents as unknown as ReportAgentsLike,
      fs: fs as unknown as ReportFsLike,
      sandboxPolicy: sandboxPolicy as unknown as ReportSandboxPolicyLike,
      ensureDirectories: async (cwd, sessionId) => {
        const agent = agents.get(sessionId)
        if (agent === undefined) throw new Error('找不到对应 agent（会话可能已结束）')
        const policy = sandboxPolicy.resolve({ session: agent.session })
        for (const dir of ['brief', 'Review', 'export']) {
          const target = join(cwd, 'reporter', dir)
          await runShell(mkdirCommand(target, IS_WINDOWS), target, policy)
        }
      },
    })
  }
}
