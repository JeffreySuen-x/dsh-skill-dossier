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
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { DIRECTION_LABELS, isDirectionLabel } from './directions.ts'
import { formatReview, reviewCandidates } from './freshness.ts'
import { dayKey, recordUsage, skillGestures, summarizeUsage } from './usage.ts'
import { atomicReplaceCommand, fsEntryOf, isWithin, mkdirCommand, moveNoClobberCommand, removeFileCommand, removeRecursiveCommand, trashDirOf } from './files.ts'
import { createRpcRoute } from './http.ts'
import { createIndexStore } from './index-store.ts'
import { estimateSkillTokens } from './tokens.ts'
import { defaultSkillRoots, scanSkillRoots, type ScanDirEntry } from './scanner.ts'
import { normalizeReportConfig, registerReportApi, type ReportAgentsLike, type ReportFsLike, type ReportWebServerLike } from './report.ts'

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
}
interface AgentLike {
  session: { header: { cwd: string } }
}
interface AgentsLike {
  get(id: string): AgentLike | undefined
  /** 在线 agent 列表（DSH 的 AgentsService 有这个；缺失时退化为只按需建） */
  list?(): AgentLike[]
}
interface FsLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<unknown>
  readText(target: unknown): Promise<string>
  listDir(target: unknown): Promise<ScanDirEntry[]>
  /** 与 @deepseek-ai/dsh-fs 的 stat(target, signal) 对齐；缺失返回 undefined。 */
  stat(target: unknown): Promise<{ type: string; size?: number } | undefined>
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

  function userMessage(text: string): unknown {
    return {
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
      id: randomUUID(),
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
      const temporaryPath = join(dir, `.index.json.${process.pid}-${randomUUID()}.tmp`)
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

  /**
   * 插件本身不携带任何信息与记录：工作区里的记录落点由插件启动时建好。
   * 只建目录、不预写文件——空索引文件由第一次真正写入时产生（少一次无谓的重写）。
   * 幂等；失败只记不抛，不拦插件加载。
   */
  function provisionWorkspace(agent: AgentLike): void {
    const { cwd } = agent.session.header
    if (typeof cwd !== 'string' || cwd === '') return
    void (async () => {
      try {
        const policy = sandboxPolicy!.resolve({ session: agent.session })
        for (const dir of [join(cwd, '.dsh', 'skill-manager'), join(cwd, 'reporter', 'brief')]) {
          await runShell(mkdirCommand(dir, IS_WINDOWS), dir, policy)
        }
      } catch (error) {
        logger?.warn?.(`skill-manager: 记录目录初始化失败（不影响使用，下次再试）：${errorMessage(error)}`)
      }
    })()
  }

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
      (name: 'agent/created', listener: (payload: any) => void): () => void
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
    // ③ 新会话出现即补建它的记录目录（插件启动时还不存在这些会话）。
    onEvent('agent/created', (payload) => {
      const agent = payload?.agent as AgentLike | undefined
      if (agent !== undefined) provisionWorkspace(agent)
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
      name: 'skill_dossier',
      description: '读取某个技能的档案（方向 / 使用范围 / 能力边界 / 应用场景 / 调用与实测情况）。技能目录里只有名称和描述，靠它无法判断边界——在决定加载某个技能全文之前，先用本工具读档案；没有档案就用 skill_archive 补一个。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名（kebab-case），取自技能目录' },
        },
        required: ['name'],
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
        const name = typeof args?.name === 'string' ? args.name.trim() : ''
        if (!NAME_RE.test(name)) throw new Error(`无效的技能名：${name}`)
        const agent = exec.agent as AgentLike | undefined
        if (agent === undefined) throw new Error('无法确定当前会话')
        const cwd = agent.session.header.cwd
        const index = await readIndex(cwd)
        const entry = index.skills[name]
        if (entry === null || entry === undefined || typeof entry !== 'object') {
          return { text: `技能「${name}」还没有档案。先读它的正文再调用 skill_archive 建档，之后这里就有边界与场景可查。` }
        }
        const usage = summarizeUsage(index.usage, Date.now()).find((item) => item.name === name)
        const lines = [
          `技能「${name}」的档案：`,
          `方向：${entry.direction ?? '未标注'}`,
          `使用范围：${entry.useScope ?? '—'}`,
          `能力边界：${entry.boundaries ?? '—'}`,
          `应用场景：${entry.scenarios ?? '—'}`,
        ]
        if (typeof entry.notes === 'string' && entry.notes !== '') lines.push(`备注：${entry.notes}`)
        lines.push(`来源：${entry.origin ?? '未标注'} · 建档 ${entry.updatedAt === undefined ? '未知' : dayKey(entry.updatedAt)}${entry.reviewedAt === undefined ? '' : ` · 复审 ${dayKey(entry.reviewedAt)}`}`)
        lines.push(usage === undefined
          ? '调用：暂无记录'
          : `调用：${usage.count} 次 · 活跃 ${usage.activeDays} 天 · 最近 ${dayKey(usage.lastUsedAt)}`)
        if (entry.outcomes !== undefined) {
          const failures = entry.outcomes.failed > 0
            ? `，失败 ${entry.outcomes.failed} 次${entry.outcomes.lastError === undefined || entry.outcomes.lastError === '' ? '' : `（最近一次：${entry.outcomes.lastError}）`}`
            : '，无失败'
          lines.push(`实测：加载成功 ${entry.outcomes.loaded} 次${failures}`)
        }
        const definition = await skills.get(name, { scope: agent as unknown, cwd })
        if (definition !== undefined && typeof definition.description === 'string') {
          lines.push(`注册表描述：${definition.description}`)
        }
        return { text: lines.join('\n') }
      },
    })
  }

  // ---------- HTTP RPC（浏览器半调用） ----------

  /**
   * 技能根扫描的短缓存。
   *
   * 为什么需要：注册表**只返回赢家**（`dsh-skill` README 写明「没有 API 可检查
   * 全部被遮蔽的定义」），要看见被遮蔽者只能自己扫盘。但面板每次打开都会调
   * `list`，而全量扫描要遍历 100+ 个 bundle、统计 11 MB 资源——实测一次约
   * 数百毫秒。所以给一个 3 秒的短缓存：面板连续刷新不重复扫，人在面板上做完
   * 一次停用/删除后再打开时（>3 秒）自然拿到新盘面。
   *
   * `ponytail:` 天花板——TTL 而非 watcher。磁盘在 3 秒内被外部改动会显示旧值；
   * 真要实时，接 `fs/observed` 或 chokidar 去 invalidate，别把 TTL 调小。
   */
  const SCAN_TTL_MS = 3000
  let scanCache: { at: number; projectRoot: string; result: Awaited<ReturnType<typeof scanSkillRoots>> } | undefined

  /** 项目根判定与宿主一致：最近的含 `.git` 的祖先，找不到就用 cwd。 */
  async function projectRootOf(cwd: string): Promise<string> {
    let current = resolvePath(cwd)
    for (let depth = 0; depth < 64; depth += 1) {
      try {
        await fs!.listDir(await fs!.resolve(join(current, '.git'), { cwd }))
        return current
      } catch { /* 没有 .git 就继续往上 */ }
      const parent = resolvePath(join(current, '..'))
      if (parent === current) break
      current = parent
    }
    return resolvePath(cwd)
  }

  async function scan(cwd: string): Promise<Awaited<ReturnType<typeof scanSkillRoots>>> {
    const projectRoot = await projectRootOf(cwd)
    const cached = scanCache
    if (cached !== undefined && cached.projectRoot === projectRoot && Date.now() - cached.at < SCAN_TTL_MS) {
      return cached.result
    }
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
    const roots = defaultSkillRoots({ projectRoot, dshHome, agentsHome })
    const result = await scanSkillRoots(
      {
        resolve: (path) => fs!.resolve(path, { cwd }) as Promise<{ targetKey: string }>,
        readText: (target) => fs!.readText(target),
        listDir: (target) => fs!.listDir(target) as Promise<ScanDirEntry[]>,
        // stat 的返回形状与 dsh-fs 的 { version, type, size } 对齐，多出的 version 无害。
        stat: (target) => fs!.stat(target) as Promise<{ type: string; size?: number } | undefined>,
      },
      roots,
      { hash: (text) => createHash('sha256').update(text).digest('hex').slice(0, 16) },
    )
    scanCache = { at: Date.now(), projectRoot, result }
    return result
  }

  /** 扫描失败不该让整个面板空白：退化成「没有扫描结果」，并如实带出原因。 */
  async function scanOrNull(cwd: string | undefined): Promise<{ scan: Awaited<ReturnType<typeof scanSkillRoots>> | null; error: string | null }> {
    if (cwd === undefined) return { scan: null, error: null }
    try {
      return { scan: await scan(cwd), error: null }
    } catch (error) {
      const message = errorMessage(error)
      logger?.warn?.(`skill-manager: 技能根扫描失败（面板退化为只看注册表）：${message}`)
      return { scan: null, error: message }
    }
  }

  const handlers: Record<string, (args: any) => Promise<unknown>> = {
    async list(args) {
      const sessionId = args?.sessionId
      const cwd = cwdOf(sessionId)
      const summaries = await skills.list(viewOptions(sessionId))
      const index = await readIndex(cwd)
      const { scan: scanned, error: scanError } = await scanOrNull(cwd)
      const byName = new Map((scanned?.skills ?? []).map((entry) => [entry.name, entry]))
      const copiesOf = new Map((scanned?.summary.conflicts ?? []).map((conflict) => [conflict.name, conflict]))
      let catalogTokens = 0
      const entries = summaries.map((s) => {
        // 口径对齐宿主：目录里只有 name + 截断后的 description，`whenToUse` 不进目录
        // （`dsh-tool-skill/lib/index.js` 的 catalogDescription()）。
        const approxTokens = estimateSkillTokens(s.name, s.description)
        catalogTokens += approxTokens
        const local = byName.get(s.name)
        const conflict = copiesOf.get(s.name)
        return {
          name: s.name,
          description: s.description,
          whenToUse: typeof s.whenToUse === 'string' ? s.whenToUse : null,
          modelInvocable: s.invocation.modelInvocable === true,
          userInvocable: s.invocation.userInvocable === true,
          source: s.source,
          provider: s.provider,
          approxTokens,
          /** 磁盘事实（来自自扫；注册表查不到时为 null）。 */
          rank: local?.rank ?? null,
          dirName: local?.dirName ?? null,
          bodyBytes: local?.bodyBytes ?? null,
          bodyTokens: local?.bodyTokens ?? null,
          assetBytes: local?.assetBytes ?? null,
          assetFiles: local?.assetFiles ?? null,
          /** 同名副本数（本 root 之外的被遮蔽者）；0 = 没有冲突。 */
          shadowed: conflict === undefined ? 0 : conflict.copies.length - 1,
          conflictIdentical: conflict?.identical ?? null,
        }
      })
      const activeNames = new Set(entries.map((entry) => entry.name))
      // 幽灵档：档案里有、当前注册表里没有——模型被指派去用一个加载不出来的技能。
      const ghosts = Object.keys(index.skills).filter((name) => !activeNames.has(name)).sort()
      return {
        skills: entries,
        index,
        usageHealth: usageWriteFailure,
        catalogTokens,
        scan: scanned?.summary ?? null,
        scanError,
        ghosts,
        shadowedCount: (scanned?.summary.conflicts ?? []).filter((conflict) => conflict.copies.length > 1).length,
      }
    },

    async get(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return null
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const skill = await skills.get(args.name, viewOptions(sessionId))
      if (skill === undefined) return null
      const cwd = cwdOf(sessionId)
      const index = await readIndex(cwd)
      const profile = Object.prototype.hasOwnProperty.call(index.skills, skill.name) ? index.skills[skill.name] : null
      const { scan: scanned } = await scanOrNull(cwd)
      const local = scanned?.skills.find((entry) => entry.name === skill.name) ?? null
      const conflict = scanned?.summary.conflicts.find((item) => item.name === skill.name) ?? null
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
        profile,
        /** 磁盘事实与同名副本（来自自扫；注册表给不出被遮蔽者）。 */
        facts: local === null
          ? null
          : {
              rank: local.rank,
              root: local.root,
              dirName: local.dirName,
              bodyBytes: local.bodyBytes,
              bodyTokens: local.bodyTokens,
              catalogTokens: local.catalogTokens,
              assetBytes: local.assetBytes,
              assetFiles: local.assetFiles,
              descriptionLength: local.description.replace(/\s+/g, ' ').trim().length,
            },
        copies: conflict === null
          ? []
          : conflict.copies.map((copy) => ({
              source: copy.source,
              rank: copy.rank,
              skillPath: copy.skillPath,
              hash: copy.hash,
              bodyBytes: copy.bodyBytes,
              winner: copy === conflict.copies[0],
            })),
      }
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

    /**
     * 同名冲突的完整盘面（含被遮蔽者）。
     *
     * 注册表永远给不出这个：落败者只留一行 logger.warn。这里返回每一组的全部
     * 副本、各自来自哪个根、内容是否一致——`identical === false` 的组是**会让人
     * 改错文件**的那批（改了 rank 400 那份以为生效，其实 rank 100 的赢）。
     */
    async conflicts(args) {
      const sessionId = typeof args?.sessionId === 'string' ? args.sessionId : undefined
      const cwd = cwdOf(sessionId)
      const { scan: scanned, error } = await scanOrNull(cwd)
      if (scanned === null) {
        return { ok: false, error: error ?? '无法确定当前工作目录' }
      }
      return {
        ok: true,
        summary: scanned.summary,
        conflicts: scanned.summary.conflicts.map((conflict) => ({
          name: conflict.name,
          identical: conflict.identical,
          copies: conflict.copies.map((copy) => ({
            source: copy.source,
            rank: copy.rank,
            root: copy.root,
            dirName: copy.dirName,
            skillPath: copy.skillPath,
            hash: copy.hash,
            bodyBytes: copy.bodyBytes,
            sameName: copy.dirName === copy.name,
          })),
        })),
      }
    },

    async uninstall(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const name = args.name
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const skill = await skills.get(name, viewOptions(sessionId))
      if (skill === undefined) return { ok: false, error: `技能 "${name}" 不存在` }
      const entryInfo = fsEntryOf(skill)
      if (entryInfo === undefined) return { ok: false, error: '该技能没有文件路径（不是文件系统技能），无法停用' }
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

  /** 一步删除 = 停用（移入 trash）+ 彻底删除。复用两步各自的路径校验与失败回滚，
   * 所以 rm 失败时技能还留在 trash 里，仍可重装；不做「直接 rm 源目录」的第二条路径。 */
  handlers.deleteSkill = async (args: any) => {
    const uninstalled = await handlers.uninstall!(args) as { ok: boolean; error?: string }
    if (uninstalled.ok !== true) return uninstalled
    return handlers.deleteTrash!(args)
  }

  const routeHandler = createRpcRoute({ handlers })

  // 启动即建：插件加载时还没有工作区概念，所以先给所有已在线的会话补一遍，
  // 之后每个新会话由 agent/created 立刻补建。
  for (const agent of agents.list?.() ?? []) provisionWorkspace(agent)

  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/skill-manager', handler: routeHandler }))
  }
  if (webServer !== undefined && agents !== undefined && fs !== undefined && sandboxPolicy !== undefined) {
    const reportConfig = normalizeReportConfig(config?.report)
    registerReportApi(ctx, {
      webServer: webServer as unknown as ReportWebServerLike,
      agents: agents as unknown as ReportAgentsLike,
      fs: fs as unknown as ReportFsLike,
      config: reportConfig,
      ensureDirectories: async (cwd, sessionId, active) => {
        const agent = agents.get(sessionId)
        if (agent === undefined) throw new Error('找不到对应 agent（会话可能已结束）')
        const policy = sandboxPolicy.resolve({ session: agent.session })
        const target = join(cwd, active.dataRoot, active.briefDir)
        await runShell(mkdirCommand(target, IS_WINDOWS), target, policy)
      },
    })
  }
}
