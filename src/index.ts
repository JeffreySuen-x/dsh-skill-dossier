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
import { DIRECTION_LABELS, isDirectionLabel } from './directions.ts'
import { formatReview, reviewCandidates } from './freshness.ts'
import { recordUsage, skillGestures } from './usage.ts'
import { atomicReplaceCommand, fsEntryOf, isWithin, mkdirCommand, moveNoClobberCommand, removeFileCommand, removeRecursiveCommand, trashDirOf } from './files.ts'
import { isCrossSiteRequest, readJsonBody, respondJson } from './http.ts'
import { createIndexStore } from './index-store.ts'
import { estimateSkillTokens } from './tokens.ts'
import { registerReportApi, type ReportAgentsLike, type ReportFsLike, type ReportSandboxPolicyLike, type ReportWebServerLike } from './report.ts'
import { normalizeReportConfig } from './report-runs.ts'

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
interface OwnedState {
  registrations: Map<string, () => void>
  disposeOwnership: () => void
}
interface AgentsLike { get(id: string): AgentLike | undefined }
interface FsLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<unknown>
  readText(target: unknown): Promise<string>
  listDir(target: unknown): Promise<Array<{ name?: string; path?: string }>>
  /** 与 @deepseek-ai/dsh-fs 的 writeText(target, content, expected, signal, sandboxPolicy) 对齐。 */
  writeText(target: unknown, content: string, expected?: unknown, signal?: unknown, policy?: unknown): Promise<unknown>
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

/** 插件 config：目前只有汇报契约（目录/技能名/分派/定时），缺省即旧行为。 */
export interface Config {
  report?: unknown
}

export function apply(ctx: Context, config?: Config): void {
  const skills = ctx.get('skills') as SkillsLike | undefined
  const agents = ctx.get('agents') as AgentsLike | undefined
  const fs = ctx.get('fs') as FsLike | undefined
  const shell = ctx.get('shell') as ShellLike | undefined
  const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  const tools = ctx.get('tools') as ToolsLike | undefined
  const webServer = ctx.get('webServer') as WebServerLike | undefined
  if (skills === undefined || agents === undefined || fs === undefined || shell === undefined || sandboxPolicy === undefined || tools === undefined || webServer === undefined) return

  const owned = new Map<AgentLike, OwnedState>()
  const temporaryBarriers = new WeakMap<AgentLike, Promise<void>>()
  let active = true
  ctx.effect(() => () => {
    active = false
    for (const state of [...owned.values()]) {
      for (const dispose of state.registrations.values()) dispose()
      state.registrations.clear()
      state.disposeOwnership()
    }
    owned.clear()
  })

  function ownedBy(agent: AgentLike): OwnedState {
    const existing = owned.get(agent)
    if (existing !== undefined) return existing
    const registrations = new Map<string, () => void>()
    let state: OwnedState | undefined
    const disposeOwnership = agent.ctx.effect(() => () => {
      registrations.clear()
      if (state !== undefined && owned.get(agent) === state) owned.delete(agent)
    })
    state = { registrations, disposeOwnership }
    owned.set(agent, state)
    return state
  }

  function releaseOwned(agent: AgentLike, state: OwnedState, name: string, dispose: () => void): void {
    if (state.registrations.get(name) !== dispose) return
    dispose()
    state.registrations.delete(name)
    releaseEmptyOwnership(agent, state)
  }

  function releaseEmptyOwnership(agent: AgentLike, state: OwnedState): void {
    if (state.registrations.size === 0 && owned.get(agent) === state) state.disposeOwnership()
  }

  function isOwned(sessionId: unknown, name: string): boolean {
    const agent = agentOf(sessionId)
    return agent !== undefined && owned.get(agent)?.registrations.has(name) === true
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

  /** 从失败的 tools/result 里取一句可读原因（截断存放，避免撑大索引）。 */
  function failureText(result: any): string {
    const direct = typeof result?.error === 'string' ? result.error : ''
    const blocks = Array.isArray(result?.content) ? result.content : []
    const fromBlocks = blocks
      .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
      .join(' ')
    const trimmed = `${direct} ${fromBlocks}`.replace(/\s+/g, ' ').trim()
    return trimmed === '' ? '加载失败（未提供原因）' : trimmed.slice(0, 200)
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

  /**
   * 索引写在自己描述的那个工作区里，所以策略必须是「以该工作区为根」的
   * workspace-write。缺省策略走的是部署回退根（`sandbox-policy.workspaceRoot`，
   * 默认 `process.cwd()`）——跨工作区打开的会话不在其下，fs 沙箱会以
   * FS_SANDBOX_DENIED 拒绝写入，而这条写路径是档案、调用统计与生命周期提交的
   * 共同出口，一旦被拒就是全量静默失效。
   */
  function indexWritePolicy(cwd: string): { mode: 'workspace-write'; workspaceRoot: string } {
    return { mode: 'workspace-write', workspaceRoot: cwd }
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
        await fs.writeText(temporaryTarget, value, undefined, undefined, indexWritePolicy(cwd))
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

  /** host logger 可能缺席（测试夹具/精简组合），缺失时只保留状态位。 */
  const logger = (ctx as unknown as { logger?: { warn?: (message: string) => void } }).logger

  /** 最近一次调用统计写入失败的原因；null = 正常。埋点失败不打断技能本身，
   * 但绝不静默——面板据此提示「统计不可用」，而不是端出一张空表。 */
  let usageWriteFailure: string | null = null

  /** 记录一次技能调用：读取 index → 折叠进 usage 与实测结果 → 回写。 */
  function recordSkillUse(cwd: string, name: string, failure?: string): void {
    if (!NAME_RE.test(name)) return
    void indexStore.update(cwd, (index) => {
      const at = Date.now()
      recordUsage(index.usage, name, at)
      const entry = index.skills[name]
      if (entry !== undefined && entry !== null && typeof entry === 'object') {
        const outcomes = entry.outcomes ?? { loaded: 0, failed: 0, lastAt: at }
        if (failure === undefined) {
          outcomes.loaded += 1
          delete outcomes.lastError
        } else {
          outcomes.failed += 1
          outcomes.lastError = failure
        }
        outcomes.lastAt = at
        entry.outcomes = outcomes
      }
    }).then(() => {
      usageWriteFailure = null
    }, (error: unknown) => {
      const message = errorMessage(error)
      if (usageWriteFailure === message) return
      usageWriteFailure = message
      logger?.warn?.(`skill-manager: 技能调用统计写入失败（不打断技能本身）：${message}`)
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
    // 成败都记：成功进 usage + loaded，失败进 failed 与 lastError——这是「实测」而非模型自述。
    onEvent('tools/result', (exec, result) => {
      if (exec?.name !== 'skill') return
      const name = exec?.arguments?.name
      if (typeof name !== 'string' || name === '') return
      const cwd = exec?.agent?.session?.header?.cwd
      if (typeof cwd !== 'string') return
      if (result?.isError !== true) { recordSkillUse(cwd, name); return }
      recordSkillUse(cwd, name, failureText(result))
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
      let catalogTokens = 0
      const entries = summaries.map((s) => {
        const approxTokens = estimateSkillTokens(s.name, s.description, typeof s.whenToUse === 'string' ? s.whenToUse : '')
        catalogTokens += approxTokens
        return {
          name: s.name,
          description: s.description,
          whenToUse: typeof s.whenToUse === 'string' ? s.whenToUse : null,
          modelInvocable: s.invocation.modelInvocable === true,
          userInvocable: s.invocation.userInvocable === true,
          source: s.source,
          provider: s.provider,
          owned: isOwned(sessionId, s.name),
          approxTokens,
        }
      })
      return { skills: entries, index, usageHealth: usageWriteFailure, catalogTokens }
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
        if (!active || agentOf(sessionId) !== agent) return { ok: false, error: '插件或当前会话已停止' }
        const scopedSkills = agent.ctx.get('skills') as SkillsLike | undefined
        if (scopedSkills === undefined) return { ok: false, error: '当前会话的 skills 服务不可用' }
        let state: OwnedState
        try {
          state = ownedBy(agent)
        } catch {
          return { ok: false, error: '插件或当前会话已停止' }
        }
        const view = { scope: agent as unknown, cwd: agent.session.header.cwd }
        let existing: boolean
        try {
          existing = (await skills.list(view)).some((s) => s.name === name)
        } catch (error) {
          releaseEmptyOwnership(agent, state)
          throw error
        }
        if (!active || agentOf(sessionId) !== agent || owned.get(agent) !== state) {
          releaseEmptyOwnership(agent, state)
          return { ok: false, error: '插件或当前会话已停止' }
        }
        if (existing && !state.registrations.has(name)) {
          releaseEmptyOwnership(agent, state)
          return { ok: false, error: `同名技能 "${name}" 已存在` }
        }
        const current = state.registrations.get(name)
        if (current !== undefined) {
          current()
          state.registrations.delete(name)
        }
        const provider = `dsh-skill-dossier:${uuid4()}`
        let dispose: () => void
        try {
          dispose = scopedSkills.register({
            name,
            description,
            ...(typeof args.whenToUse === 'string' && args.whenToUse.trim() !== '' ? { whenToUse: args.whenToUse.trim() } : {}),
            content,
            source: 'custom',
            provider,
            invocation: {
              modelInvocable: args.modelInvocable !== false,
              userInvocable: args.userInvocable !== false,
            },
          })
        } catch {
          releaseEmptyOwnership(agent, state)
          return { ok: false, error: '插件或当前会话已停止' }
        }
        state.registrations.set(name, dispose)
        let winner: DefinitionLike | undefined
        try {
          winner = await skills.get(name, view)
        } catch (error) {
          releaseOwned(agent, state, name, dispose)
          throw error
        }
        if (!active || agentOf(sessionId) !== agent || owned.get(agent) !== state || state.registrations.get(name) !== dispose) {
          releaseOwned(agent, state, name, dispose)
          return { ok: false, error: '插件或当前会话已停止' }
        }
        if (winner?.provider !== provider) {
          releaseOwned(agent, state, name, dispose)
          return { ok: false, error: `同名技能 "${name}" 已存在` }
        }
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
        const state = owned.get(agent)
        if (state === undefined) return { ok: false, error: '该技能不是本会话注册的临时技能' }
        const dispose = state.registrations.get(args.name)
        if (dispose === undefined) return { ok: false, error: '该技能不是本会话注册的临时技能' }
        releaseOwned(agent, state, args.name, dispose)
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
    const reportConfig = normalizeReportConfig(config?.report)
    const timer = ctx.get('timer') as { interval?: (callback: () => void, delay: number) => () => void } | undefined
    registerReportApi(ctx, {
      webServer: webServer as unknown as ReportWebServerLike,
      agents: agents as unknown as ReportAgentsLike,
      fs: fs as unknown as ReportFsLike,
      sandboxPolicy: sandboxPolicy as unknown as ReportSandboxPolicyLike,
      config: reportConfig,
      ...(typeof timer?.interval === 'function'
        ? { interval: (callback: () => void, delayMs: number) => timer.interval!(callback, delayMs) }
        : {}),
      ensureDirectories: async (cwd, sessionId, active) => {
        const agent = agents.get(sessionId)
        if (agent === undefined) throw new Error('找不到对应 agent（会话可能已结束）')
        const policy = sandboxPolicy.resolve({ session: agent.session })
        for (const dir of [active.briefDir, active.reviewDir, active.exportDir]) {
          const target = join(cwd, active.dataRoot, dir)
          await runShell(mkdirCommand(target, IS_WINDOWS), target, policy)
        }
      },
    })
  }
}
