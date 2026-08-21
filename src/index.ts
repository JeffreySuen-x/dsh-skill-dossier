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
import { isAbsolute, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { formatMatches, matchSkills, type SkillMatch, type SkillProfile } from './match.ts'
import { fsEntryOf, isWithin, mkdirCommand, moveNoClobberCommand, removeRecursiveCommand, trashDirOf } from './files.ts'

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
export const inject = ['skills', 'tools', 'webServer', 'agents']

const DIRECTIONS = ['开发工程', '前端视觉', '研究分析', '内容创作', '知识库', '记忆复盘', '元技能', '工具集成', '其他']
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
interface AgentLike { session: { header: { cwd: string } } }
interface AgentsLike { get(id: string): AgentLike | undefined }
interface FsLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<unknown>
  readText(target: unknown): Promise<string>
  writeText(target: unknown, content: string): Promise<unknown>
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
  resolve(request: { mode: string }): unknown
}
interface ToolsLike { register(tool: unknown): () => void }
interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: unknown, res: any) => void | Promise<void>
}
interface WebServerLike { register(route: WebRouteLike): () => void }

interface IndexEntry {
  name: string
  direction?: string
  useScope?: string
  boundaries?: string
  scenarios?: string
  notes?: string
  origin?: 'self' | 'external' | 'system' | 'unknown'
  updatedAt: number
}
interface TrashRecord {
  name: string
  originalPath: string
  trashedPath: string
  root: string
  removedAt: number
}
interface ArchiveIndex {
  version: number
  skills: Record<string, IndexEntry>
  trash: Record<string, TrashRecord>
}

export function apply(ctx: Context): void {
  const skills = ctx.get('skills') as SkillsLike | undefined
  if (skills === undefined) return
  const agents = ctx.get('agents') as AgentsLike | undefined
  const fs = ctx.get('fs') as FsLike | undefined
  const shell = ctx.get('shell') as ShellLike | undefined
  const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  const tools = ctx.get('tools') as ToolsLike | undefined
  const webServer = ctx.get('webServer') as WebServerLike | undefined

  const owned = new Map<string, () => void>()
  ctx.effect(() => () => {
    for (const dispose of owned.values()) dispose()
    owned.clear()
  })

  function viewOptions(sessionId: unknown) {
    if (agents === undefined || typeof sessionId !== 'string') return {}
    const agent = agents.get(sessionId)
    if (agent === undefined) return {}
    return { scope: agent as unknown, cwd: agent.session.header.cwd }
  }

  function agentOf(sessionId: unknown): AgentLike | undefined {
    if (agents === undefined || typeof sessionId !== 'string') return undefined
    return agents.get(sessionId)
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

  function emptyIndex(): ArchiveIndex {
    return { version: 1, skills: {}, trash: {} }
  }

  function normalizeIndex(parsed: unknown): ArchiveIndex {
    const p = (parsed ?? {}) as { skills?: unknown; trash?: unknown }
    return {
      version: 1,
      skills: p.skills !== null && typeof p.skills === 'object' ? p.skills as Record<string, IndexEntry> : {},
      trash: p.trash !== null && typeof p.trash === 'object' ? p.trash as Record<string, TrashRecord> : {},
    }
  }

  async function readIndex(cwd: string | undefined): Promise<ArchiveIndex> {
    if (fs === undefined || cwd === undefined) return emptyIndex()
    try {
      const target = await fs.resolve(join(cwd, '.dsh', 'skill-manager', 'index.json'), { cwd })
      return normalizeIndex(JSON.parse(await fs.readText(target)))
    } catch (error) {
      return emptyIndex()
    }
  }

  async function runShell(command: string, targetPath: string): Promise<void> {
    if (shell === undefined) throw new Error('shell 服务不可用')
    const request: { command: string; sandboxPolicy?: unknown } = { command }
    if (sandboxPolicy !== undefined) {
      const ws = sandboxPolicy.workspaceRoot
      const mode = ws !== undefined && isWithin(targetPath, ws) ? 'workspace-write' : 'danger-full-access'
      request.sandboxPolicy = sandboxPolicy.resolve({ mode })
    }
    const result = await shell.run(shell.resolve(request))
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

  async function writeIndex(cwd: string | undefined, index: ArchiveIndex): Promise<void> {
    if (fs === undefined) throw new Error('fs 服务不可用')
    if (cwd === undefined) throw new Error('无法确定当前工作目录')
    await runShell(mkdirCommand(join(cwd, '.dsh', 'skill-manager'), IS_WINDOWS), join(cwd, '.dsh'))
    const target = await fs.resolve(join(cwd, '.dsh', 'skill-manager', 'index.json'), { cwd })
    await fs.writeText(target, JSON.stringify(index, null, 2))
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

  // ---------- 模型工具：skill_archive ----------

  if (tools !== undefined) {
    tools.register({
      name: 'skill_archive',
      description: '为技能写档案（方向分类、使用范围、能力边界、应用场景），持久化到工作区 .dsh/skill-manager/index.json。先读取技能内容并分析，再调用本工具落盘。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名（kebab-case）' },
          direction: { type: 'string', description: `方向分类，如：${DIRECTIONS.join('/')}` },
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
        const exists = (await skills.list(lookup)).some((s) => s.name === name)
        if (!exists) throw new Error(`技能 "${name}" 不存在，请先安装或注册`)
        const direction = typeof args.direction === 'string' ? args.direction.trim() : ''
        const useScope = typeof args.useScope === 'string' ? args.useScope.trim() : ''
        const boundaries = typeof args.boundaries === 'string' ? args.boundaries.trim() : ''
        const scenarios = typeof args.scenarios === 'string' ? args.scenarios.trim() : ''
        if (direction === '' || useScope === '' || boundaries === '' || scenarios === '') {
          throw new Error('direction/useScope/boundaries/scenarios 均不能为空')
        }
        const origin: 'self' | 'external' | 'system' | 'unknown' = args.origin === 'self' || args.origin === 'external' || args.origin === 'system' || args.origin === 'unknown'
          ? args.origin
          : 'unknown'
        const index = await readIndex(cwd)
        index.skills[name] = {
          name,
          direction,
          useScope,
          boundaries,
          scenarios,
          notes: typeof args.notes === 'string' && args.notes.trim() !== '' ? args.notes.trim() : undefined,
          origin,
          updatedAt: Date.now(),
        }
        await writeIndex(cwd, index)
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
          direction: { type: 'string', description: `可选：只在该方向分类内匹配（${DIRECTIONS.join('/')}）` },
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
          owned: owned.has(s.name),
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
        owned: owned.has(skill.name),
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
      const opts = viewOptions(typeof args.sessionId === 'string' ? args.sessionId : undefined)
      const existing = (await skills.list(opts)).some((s) => s.name === name)
      if (existing && !owned.has(name)) return { ok: false, error: `同名技能 "${name}" 已存在` }
      const previous = owned.get(name)
      if (previous !== undefined) { previous(); owned.delete(name) }
      const dispose = skills.register({
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
      owned.set(name, dispose)
      return { ok: true }
    },

    async unregister(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const dispose = owned.get(args.name)
      if (dispose === undefined) return { ok: false, error: '该技能不是本插件注册的临时技能' }
      dispose()
      owned.delete(args.name)
      return { ok: true }
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
        + `分析它属于哪个方向（候选：${DIRECTIONS.join('、')}），`
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
      const index = await readIndex(cwd)
      const trashDir = trashDirOf(entryInfo.root)
      const trashedPath = join(trashDir, `${name}-${Date.now()}`)
      await runShell(mkdirCommand(trashDir, IS_WINDOWS), entryInfo.root)
      await runShell(moveNoClobberCommand(entryInfo.entry, trashedPath, IS_WINDOWS), entryInfo.root)
      index.trash[name] = { name, originalPath: entryInfo.entry, trashedPath, root: entryInfo.root, removedAt: Date.now() }
      await writeIndex(cwd, index)
      return { ok: true }
    },

    async reinstall(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const name = args.name
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const cwd = cwdOf(sessionId)
      if (cwd === undefined) return { ok: false, error: '无法确定当前工作目录' }
      const index = await readIndex(cwd)
      const record = index.trash[name]
      if (record === null || typeof record !== 'object') return { ok: false, error: '未找到该技能的停用记录' }
      const { trashedPath, originalPath, root } = record
      if (typeof trashedPath !== 'string' || typeof originalPath !== 'string' || typeof root !== 'string' || trashedPath === '' || originalPath === '' || root === '') {
        return { ok: false, error: '停用记录损坏' }
      }
      if (await realpathWithin(trashedPath, trashDirOf(root)) !== true) return { ok: false, error: '停用记录路径异常，拒绝操作' }
      if (!isWithin(originalPath, root)) return { ok: false, error: '停用记录路径异常，拒绝操作' }
      await runShell(moveNoClobberCommand(trashedPath, originalPath, IS_WINDOWS), root)
      delete index.trash[name]
      await writeIndex(cwd, index)
      return { ok: true }
    },

    async deleteTrash(args) {
      if (args === null || typeof args !== 'object' || typeof args.name !== 'string') return { ok: false, error: '参数无效' }
      const name = args.name
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
      const cwd = cwdOf(sessionId)
      if (cwd === undefined) return { ok: false, error: '无法确定当前工作目录' }
      const index = await readIndex(cwd)
      const record = index.trash[name]
      if (record === null || typeof record !== 'object') return { ok: false, error: '未找到该技能的停用记录' }
      const { trashedPath, root } = record
      if (typeof trashedPath !== 'string' || typeof root !== 'string' || trashedPath === '' || root === '') {
        return { ok: false, error: '停用记录损坏' }
      }
      if (await realpathWithin(trashedPath, trashDirOf(root)) === false) return { ok: false, error: '停用记录路径异常，拒绝操作' }
      await runShell(removeRecursiveCommand(trashedPath, IS_WINDOWS), root)
      delete index.trash[name]
      await writeIndex(cwd, index)
      return { ok: true }
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
      const index = await readIndex(cwd)
      const entry = index.skills[name]
      if (entry === null || typeof entry !== 'object') {
        index.skills[name] = { name, origin, updatedAt: Date.now() }
      } else {
        entry.origin = origin
        entry.updatedAt = Date.now()
      }
      await writeIndex(cwd, index)
      return { ok: true }
    },
  }

  async function readJsonBody(req: any): Promise<unknown> {
    let body = ''
    for await (const chunk of req) {
      body += String(chunk)
      if (body.length > MAX_BODY_BYTES) throw new Error('请求体过大')
    }
    return body === '' ? {} : JSON.parse(body)
  }

  function respond(res: any, status: number, payload: unknown): void {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }

  /** 拒绝跨站请求：浏览器发 `Sec-Fetch-Site: cross-site`，或 `Origin` 与 Host 不符。
   * 本 API 破坏性方法（停用/重装/删除）会 mv/rm，必须挡住 CSRF。 */
  function isCrossSiteRequest(req: any): boolean {
    const site = req.headers['sec-fetch-site']
    if (typeof site === 'string' && site === 'cross-site') return true
    const origin = req.headers['origin']
    if (typeof origin !== 'string' || origin === '') return false
    const host = req.headers['host']
    if (typeof host !== 'string' || host === '') return true
    try {
      return new URL(origin).host !== host
    } catch {
      return true
    }
  }

  const routeHandler = async (req: any, res: any): Promise<void> => {
    try {
      if (req.method !== 'POST') {
        respond(res, 405, { error: 'method not allowed' })
        return
      }
      if (isCrossSiteRequest(req)) {
        respond(res, 403, { error: '跨站请求被拒绝' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(req)
      } catch (error) {
        respond(res, 400, { error: `请求体无效：${String(error)}` })
        return
      }
      const { method, args } = (body ?? {}) as { method?: unknown; args?: unknown }
      if (typeof method !== 'string') {
        respond(res, 400, { error: '缺少 method 字段' })
        return
      }
      const handler = handlers[method]
      if (handler === undefined) {
        respond(res, 404, { error: `未知方法：${method}` })
        return
      }
      const result = await handler(args)
      respond(res, 200, result)
    } catch (error) {
      respond(res, 500, { error: String(error) })
    }
  }

  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/api/skill-manager', handler: routeHandler }))
  }
}
