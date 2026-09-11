import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'

interface Route {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => unknown
}

interface FakeSkill {
  name: string
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  source: string
  provider: string
  content: string
  path?: string
}

function currentDateKey(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function hostContext(options: {
  cwd?: string
  listDir?: () => Promise<Array<{ name?: string; path?: string }>>
  writeText?: (target: unknown, content: string, encoding?: unknown, opts?: unknown, policy?: unknown) => Promise<void>
  followup?: (message: unknown) => void
  indexText?: string
  indexReadError?: Error
  /** 可变的「路径后缀 → 内容」表：测试用它模拟 agent 写产物与 brief 回写目标。 */
  files?: Map<string, string>
  shellRun?: (request: any) => Promise<{ exitCode: number; stderr?: { text?: string } }>
  skill?: FakeSkill
  listSkills?: (
    view: unknown,
    visible: FakeSkill[],
    registerSessionSkill: (sessionId: string, skill: FakeSkill) => () => void,
  ) => Promise<FakeSkill[]>
} = {}) {
  const routes = new Map<string, Route>()
  const services = new Map<string, unknown>()
  const today = currentDateKey()
  const shellCommands: string[] = []
  /** 每次 fs.writeText 的目标与策略，供「写路径是否带上工作区策略」这类断言使用。 */
  const writeCalls: Array<{ target: string; policy: unknown }> = []
  /** ctx.on 注册的监听器；host 事件（tools/result、agent/inbox/claimed）由此驱动。 */
  const listeners = new Map<string, Array<(...args: any[]) => unknown>>()
  const cwd = options.cwd ?? (process.platform === 'win32' ? 'C:\\workspace' : '/workspace')
  const globalRuntime = new Map<string, FakeSkill>()
  const sessionRuntime = new Map<string, Map<string, FakeSkill>>()
  const sessionDisposers = new Map<string, Set<() => void>>()
  const sessionActive = new Map<string, boolean>()
  const pluginDisposers = new Set<() => void>()
  const scopeIds = new WeakMap<object, string>()

  function registerInto(target: Map<string, FakeSkill>, input: unknown, disposers?: Set<() => void>): () => void {
    const value = input as Partial<FakeSkill>
    if (typeof value.name !== 'string' || target.has(value.name)) return () => undefined
    const skill: FakeSkill = {
      name: value.name,
      description: String(value.description ?? ''),
      ...(typeof value.whenToUse === 'string' ? { whenToUse: value.whenToUse } : {}),
      invocation: value.invocation ?? { modelInvocable: true, userInvocable: true },
      source: String(value.source ?? 'runtime'),
      provider: String(value.provider ?? 'runtime'),
      content: String(value.content ?? ''),
    }
    target.set(skill.name, skill)
    let active = true
    const dispose = () => {
      if (!active) return
      active = false
      if (target.get(skill.name) === skill) target.delete(skill.name)
      disposers?.delete(dispose)
    }
    disposers?.add(dispose)
    return dispose
  }

  function visibleSkills(sessionId?: string): FakeSkill[] {
    const result = options.skill === undefined ? [] : [options.skill]
    for (const skill of globalRuntime.values()) result.push(skill)
    if (sessionId !== undefined) {
      for (const skill of sessionRuntime.get(sessionId)?.values() ?? []) result.push(skill)
    }
    return result
  }

  function sessionIdOf(view: unknown): string | undefined {
    if (view === null || typeof view !== 'object' || !('scope' in view)) return undefined
    const scope = view.scope
    return scope !== null && typeof scope === 'object' ? scopeIds.get(scope) : undefined
  }

  const rootSkills = {
    list: async (view?: unknown) => {
      const visible = visibleSkills(sessionIdOf(view))
      return options.listSkills === undefined
        ? visible
        : options.listSkills(view, visible, (sessionId, skill) => {
            const runtime = sessionRuntime.get(sessionId)
            if (runtime === undefined) return () => undefined
            return registerInto(runtime, skill, sessionDisposers.get(sessionId))
          })
    },
    get: async (name: string, view?: unknown) => visibleSkills(sessionIdOf(view)).find((skill) => skill.name === name),
    register: (skill: unknown) => registerInto(globalRuntime, skill),
  }
  services.set('skills', rootSkills)
  services.set('tools', { register: () => () => undefined })
  services.set('webServer', {
    register(route: Route) {
      if (routes.has(route.path)) throw new Error(`duplicate route: ${route.path}`)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  })
  const sessionAgents = new Map<string, any>()
  for (const id of ['session-1', 'session-2']) {
    sessionActive.set(id, true)
    const disposers = new Set<() => void>()
    sessionDisposers.set(id, disposers)
    const runtime = new Map<string, FakeSkill>()
    sessionRuntime.set(id, runtime)
    const scopedSkills = {
      ...rootSkills,
      register: (skill: unknown) => registerInto(runtime, skill, disposers),
    }
    const agent = {
      session: { header: { cwd } },
      followup: options.followup ?? (() => undefined),
      ctx: {
        get: (name: string) => name === 'skills' ? scopedSkills : undefined,
        effect: (setup: () => unknown) => {
          if (sessionActive.get(id) !== true) throw new Error('INACTIVE_EFFECT cannot create effect on inactive context')
          const cleanup = setup()
          let effectActive = true
          const dispose = () => {
            if (!effectActive) return
            effectActive = false
            disposers.delete(dispose)
            if (typeof cleanup === 'function') cleanup()
          }
          disposers.add(dispose)
          return dispose
        },
      },
    }
    scopeIds.set(agent, id)
    sessionAgents.set(id, agent)
  }
  services.set('agents', { get: (id: string) => sessionAgents.get(id) })
  services.set('fs', {
    resolve: async (path: string, options?: { cwd?: string }) => isAbsolute(path)
      ? path
      : join(options?.cwd ?? '', path),
    listDir: options.listDir ?? (async () => [{ name: `${today}.md` }]),
    readText: async (target: unknown) => {
      const normalized = String(target).replaceAll('\\', '/')
      if (normalized.endsWith('/.dsh/skill-manager/index.json')) {
        if (options.indexReadError !== undefined) throw options.indexReadError
        // 显式给的 indexText 优先（多数用例用它）；没有就给真的落过盘的读回来，
        // 否则「写入 → 再读」的多步流程会读到陈旧替身。
        if (options.indexText !== undefined) return options.indexText
        try {
          return readFileSync(String(target), 'utf8')
        } catch {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
      }
      for (const [suffix, content] of options.files ?? []) {
        if (normalized.endsWith(suffix)) return content
      }
      // 用例给了 files 就是声明了整套文件系统：没列出来的文件必须真的不存在，
      // 否则「区间里某些天没有简报」这类语义会被替身悄悄填上假数据。
      if (options.files !== undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return `---\ndate: ${today}\n---\n\n# Brief\n\n## 管理插件\n- 作用：管理技能\n- 实现：host + client\n- 今日进度：\n  1. 单包汇报\n- 待办：\n- 问题：\n`
    },
    writeText: async (target: unknown, content: string, encoding?: unknown, opts?: unknown, policy?: unknown) => {
      writeCalls.push({ target: String(target), policy })
      await options.writeText?.(target, content, encoding, opts, policy)
    },
  })
  services.set('shell', {
    resolve: (request: unknown) => request,
    run: async (request: any) => {
      shellCommands.push(String(request?.command ?? ''))
      return options.shellRun === undefined ? { exitCode: 0 } : options.shellRun(request)
    },
  })
  services.set('sandboxPolicy', { workspaceRoot: cwd, resolve: () => ({}) })

  const ctx = {
    get(name: string) { return services.get(name) },
    on(name: string, listener: (...args: any[]) => unknown) {
      const registered = listeners.get(name) ?? []
      registered.push(listener)
      listeners.set(name, registered)
      return () => {
        const index = registered.indexOf(listener)
        if (index >= 0) registered.splice(index, 1)
      }
    },
    effect(setup: () => unknown) {
      const dispose = setup()
      if (typeof dispose === 'function') pluginDisposers.add(dispose as () => void)
      return dispose
    },
  }
  return {
    ctx,
    cwd,
    routes,
    shellCommands,
    writeCalls,
    /** 触发一次 host 事件（tools/result、agent/inbox/claimed），驱动插件埋点。 */
    emit(name: string, ...args: any[]) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(...args)
    },
    disposeSession(id: string) {
      sessionActive.set(id, false)
      for (const dispose of [...(sessionDisposers.get(id) ?? [])].reverse()) dispose()
      sessionAgents.delete(id)
    },
    disposePlugin() {
      for (const dispose of [...pluginDisposers].reverse()) dispose()
      pluginDisposers.clear()
    },
    sessionSkillNames(id: string) {
      return [...(sessionRuntime.get(id)?.keys() ?? [])]
    },
    sessionDisposerCount(id: string) {
      return sessionDisposers.get(id)?.size ?? 0
    },
  }
}

async function post(route: Route, body: unknown, headers: Record<string, string> = { host: '127.0.0.1:3080' }) {
  const request = Readable.from([JSON.stringify(body)]) as Readable & { method: string; headers: Record<string, string> }
  request.method = 'POST'
  request.headers = headers
  let responseBody = ''
  const response = {
    statusCode: 0,
    setHeader: () => undefined,
    end: (value: string) => { responseBody = value },
  }
  await route.handler(request, response)
  return { status: response.statusCode, body: JSON.parse(responseBody) as any }
}

function runNativeCommand(request: any): { exitCode: number; stderr: { text: string } } {
  const command = String(request?.command ?? '')
  const result = process.platform === 'win32'
    ? spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' })
    : spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' })
  return { exitCode: result.status ?? 1, stderr: { text: result.stderr } }
}

function isAtomicReplace(command: string): boolean {
  return process.platform === 'win32'
    ? command.startsWith('[System.IO.File]::Move(')
    : command.startsWith('mv -f -- ')
}

function isTemporaryFileCleanup(command: string): boolean {
  return process.platform === 'win32'
    ? command.startsWith('Remove-Item -Force -LiteralPath ')
    : command.startsWith('rm -f -- ')
}

function isLifecycleMove(command: string): boolean {
  return process.platform === 'win32'
    ? command.includes('[DshSkillManagerNativeMove]::MoveFileEx(')
    : command.includes('mv -n -- ')
}

/**
 * 行为替身：复刻 `dsh-fs-sandbox` 的 `checkedTarget` 判定——mode 必须是
 * workspace-write，且目标落在 `policy.workspaceRoot` 之下。缺省策略走的是部署
 * 回退根（dsh 进程 cwd），跨工作区打开的会话不在其下，写入会被
 * `FS_SANDBOX_DENIED` 拒绝；这正是索引写路径曾经全量静默失效的原因。
 */
async function rejectingSandboxWrite(
  target: unknown,
  _content: string,
  _encoding?: unknown,
  _opts?: unknown,
  policy?: unknown,
): Promise<void> {
  const value = policy as { mode?: string; workspaceRoot?: string } | undefined
  const normalized = String(target).replaceAll('\\', '/')
  const rooted = value?.mode === 'workspace-write'
    && typeof value.workspaceRoot === 'string'
    && normalized.startsWith(String(value.workspaceRoot).replaceAll('\\', '/'))
  if (!rooted) {
    throw new Error(`FsError: cannot write "${String(target)}": file access denied under workspace-write mode`)
  }
}

/** 轮询等待异步副作用（埋点是 fire-and-forget，测试必须等它落定）。 */
async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await condition()) return
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('single-package host activation', () => {
  it('registers manager and report APIs from the manager package alone', () => {
    const { ctx, routes } = hostContext()

    apply(ctx as never)

    expect([...routes.keys()].sort()).toEqual(['/api/report', '/api/skill-manager'])
    expect(inject).toEqual(expect.arrayContaining(['fs', 'shell', 'sandboxPolicy']))
  })

  it('serves brief data and rejects cross-site report requests', async () => {
    const { ctx, routes } = hostContext()
    apply(ctx as never)
    const route = routes.get('/api/report')
    expect(route).toBeDefined()

    const daily = await post(route!, { method: 'generateDaily', args: { sessionId: 'session-1' } })
    expect(daily.status).toBe(200)
    expect(daily.body.lastError).toBe('')
    expect(daily.body.projects).toEqual([
      expect.objectContaining({ name: '管理插件', progress: ['单包汇报'] }),
    ])

    const crossSite = await post(
      route!,
      { method: 'generateDaily', args: { sessionId: 'session-1' } },
      { host: '127.0.0.1:3080', origin: 'https://example.invalid' },
    )
    expect(crossSite).toEqual({ status: 403, body: { error: '跨站请求被拒绝' } })
  })

  it('preserves cross-site protection on the manager API after sharing HTTP helpers', async () => {
    const { ctx, routes } = hostContext()
    apply(ctx as never)

    const crossSite = await post(
      routes.get('/api/skill-manager')!,
      { method: 'list', args: {} },
      { host: '127.0.0.1:3080', origin: 'https://example.invalid' },
    )

    expect(crossSite).toEqual({ status: 403, body: { error: '跨站请求被拒绝' } })
  })

  it('surfaces a corrupt manager index instead of replacing it with an empty one', async () => {
    const writes: unknown[] = []
    const { ctx, routes } = hostContext({
      indexText: '{oops',
      writeText: async (target) => { writes.push(target) },
    })
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, { method: 'list', args: { sessionId: 'session-1' } })

    expect(response.status).toBe(500)
    expect(response.body.error).toContain('索引文件损坏')
    expect(writes).toEqual([])
  })

  it('writes manager index changes through a same-directory atomic replacement', async () => {
    const writes: string[] = []
    const { ctx, routes, shellCommands } = hostContext({
      writeText: async (target) => { writes.push(String(target)) },
    })
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, {
      method: 'setOrigin',
      args: { sessionId: 'session-1', name: 'alpha', origin: 'self' },
    })

    expect(response).toEqual({ status: 200, body: { ok: true } })
    expect(writes).toHaveLength(1)
    expect(writes[0].replaceAll('\\', '/')).toMatch(/\/\.dsh\/skill-manager\/\.index\.json\..+\.tmp$/)
    expect(shellCommands.some(isAtomicReplace)).toBe(true)
    expect(shellCommands.some((command) => command.replaceAll('\\', '/').includes('/.dsh/skill-manager/index.json'))).toBe(true)
  })

  it('reports atomic replacement failure and attempts to clean the temporary file', async () => {
    const writes: string[] = []
    const { ctx, routes, shellCommands } = hostContext({
      writeText: async (target) => { writes.push(String(target)) },
      shellRun: async (request) => isAtomicReplace(String(request?.command ?? ''))
        ? { exitCode: 1, stderr: { text: 'replace failed' } }
        : { exitCode: 0 },
    })
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, {
      method: 'setOrigin',
      args: { sessionId: 'session-1', name: 'alpha', origin: 'self' },
    })

    expect(response.status).toBe(500)
    expect(response.body.error).toContain('replace failed')
    expect(writes).toHaveLength(1)
    expect(shellCommands.some(isTemporaryFileCleanup)).toBe(true)
  })

  it('attempts temporary-file cleanup when staging the new index fails', async () => {
    const { ctx, routes, shellCommands } = hostContext({
      writeText: async () => { throw new Error('stage failed') },
    })
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, {
      method: 'setOrigin',
      args: { sessionId: 'session-1', name: 'alpha', origin: 'self' },
    })

    expect(response.status).toBe(500)
    expect(response.body.error).toContain('stage failed')
    expect(shellCommands.some(isTemporaryFileCleanup)).toBe(true)
  })

  it('writes the index under a workspace-rooted policy the fs sandbox accepts', async () => {
    const { ctx, routes, writeCalls } = hostContext({ cwd: '/workspace', writeText: rejectingSandboxWrite })
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, {
      method: 'setOrigin',
      args: { sessionId: 'session-1', name: 'alpha', origin: 'self' },
    })

    expect(response).toEqual({ status: 200, body: { ok: true } })
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: '/workspace' })
  })

  it('records a skill load reported by tools/result into usage', async () => {
    const written: string[] = []
    const host = hostContext({
      writeText: async (_target: unknown, content: string) => { written.push(String(content)) },
    })
    apply(host.ctx as never)

    host.emit(
      'tools/result',
      { name: 'skill', arguments: { name: 'ponytail' }, agent: { session: { header: { cwd: host.cwd } } } },
      { isError: false },
    )
    await waitFor(() => written.length > 0)

    expect(JSON.parse(written[0]!).usage.ponytail.count).toBe(1)
  })

  it('records a failed skill load as an observed outcome, not just a skipped call', async () => {
    const written: string[] = []
    const host = hostContext({
      indexText: JSON.stringify({
        version: 1,
        skills: { ponytail: { name: 'ponytail', direction: '工程代码' } },
        trash: {},
        usage: {},
      }),
      writeText: async (_target: unknown, content: string) => { written.push(String(content)) },
    })
    apply(host.ctx as never)

    host.emit(
      'tools/result',
      { name: 'skill', arguments: { name: 'ponytail' }, agent: { session: { header: { cwd: host.cwd } } } },
      { isError: true, error: 'skill not found' },
    )
    await waitFor(() => written.length > 0)

    const index = JSON.parse(written[0]!)
    expect(index.usage.ponytail.count).toBe(1)
    expect(index.skills.ponytail.outcomes).toMatchObject({ loaded: 0, failed: 1, lastError: 'skill not found' })
  })

  it('surfaces a usage write failure instead of swallowing it', async () => {    const host = hostContext({ writeText: async () => { throw new Error('FsError: file access denied') } })
    apply(host.ctx as never)

    host.emit(
      'tools/result',
      { name: 'skill', arguments: { name: 'ponytail' }, agent: { session: { header: { cwd: host.cwd } } } },
      { isError: false },
    )
    const route = host.routes.get('/api/skill-manager')!
    let health: unknown = null
    await waitFor(async () => {
      health = (await post(route, { method: 'list', args: { sessionId: 'session-1' } })).body.usageHealth
      return health !== null
    })

    expect(String(health)).toContain('file access denied')
  })

  it('does not create or rewrite the index for a rejected lifecycle operation', async () => {
    const writes: string[] = []
    const { ctx, routes } = hostContext({
      writeText: async (target) => { writes.push(String(target)) },
    })
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, {
      method: 'reinstall',
      args: { sessionId: 'session-1', name: 'missing' },
    })

    expect(response).toEqual({ status: 200, body: { ok: false, error: '未找到该技能的停用记录' } })
    expect(writes).toEqual([])
  })

  it('deletes a filesystem skill in one step: trash it, then remove it', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-skill-dossier-delete-'))
    const skillDir = join(base, 'skills', 'alpha')
    const skillPath = join(skillDir, 'SKILL.md')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(skillPath, '# alpha')
    try {
      const { ctx, routes, shellCommands } = hostContext({
        cwd: base,
        skill: {
          name: 'alpha',
          description: 'test skill',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'custom',
          provider: 'filesystem',
          content: '# alpha',
          path: skillPath,
        },
        // 这条用例走真实文件系统：临时索引必须真的落盘，原子替换才移得动。
        writeText: async (target: unknown, content: string) => { writeFileSync(String(target), String(content)) },
        shellRun: async (request) => runNativeCommand(request),
      })
      apply(ctx as never)

      const response = await post(routes.get('/api/skill-manager')!, {
        method: 'deleteSkill',
        args: { sessionId: 'session-1', name: 'alpha' },
      })

      expect(response).toEqual({ status: 200, body: { ok: true } })
      // 先移入 trash（生命周期移动），再递归删除——不做「直接 rm 源目录」的第二条路径。
      expect(shellCommands.filter(isLifecycleMove)).toHaveLength(1)
      expect(shellCommands.some((command) => command.replaceAll('\\', '/').includes('/skill-manager/trash/'))).toBe(true)
      expect(shellCommands.some((command) => command.startsWith('rm -rf -- ') || command.startsWith('Remove-Item -Recurse'))).toBe(true)
      expect(existsSync(skillDir)).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('refuses to delete a skill that is not filesystem-backed', async () => {
    const { ctx, routes } = hostContext({
      skill: {
        name: 'alpha',
        description: 'built-in',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled',
        provider: 'bundled',
        content: '# alpha',
      },
    })
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, {
      method: 'deleteSkill',
      args: { sessionId: 'session-1', name: 'alpha' },
    })

    expect(response.body).toEqual({ ok: false, error: '该技能不是文件系统技能，无法停用' })
  })

  it('moves an uninstalled skill back when the index commit fails', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-skill-dossier-uninstall-'))
    const skillDir = join(base, 'skills', 'alpha')
    const skillPath = join(skillDir, 'SKILL.md')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(skillPath, '# alpha')
    try {
      const { ctx, routes, shellCommands } = hostContext({
        cwd: base,
        skill: {
          name: 'alpha',
          description: 'test skill',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'custom',
          provider: 'filesystem',
          content: '# alpha',
          path: skillPath,
        },
        shellRun: async (request) => isAtomicReplace(String(request?.command ?? ''))
          ? { exitCode: 1, stderr: { text: 'commit failed' } }
          : runNativeCommand(request),
      })
      apply(ctx as never)

      const response = await post(routes.get('/api/skill-manager')!, {
        method: 'uninstall',
        args: { sessionId: 'session-1', name: 'alpha' },
      })

      const moves = shellCommands.filter(isLifecycleMove)
      expect(response.status).toBe(500)
      expect(response.body.error).toContain('commit failed')
      expect(moves).toHaveLength(2)
      expect(readFileSync(skillPath, 'utf8')).toBe('# alpha')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('moves a reinstalled skill back to trash when the index commit fails', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-skill-dossier-reinstall-'))
    const root = join(base, 'skills')
    const trashDir = join(base, 'skill-manager', 'trash')
    const trashedPath = join(trashDir, 'alpha-1')
    const originalPath = join(root, 'alpha')
    mkdirSync(root, { recursive: true })
    mkdirSync(trashedPath, { recursive: true })
    writeFileSync(join(trashedPath, 'SKILL.md'), '# alpha')
    try {
      const { ctx, routes, shellCommands } = hostContext({
        cwd: base,
        indexText: JSON.stringify({
          version: 1,
          skills: {},
          usage: {},
          trash: { alpha: { name: 'alpha', originalPath, trashedPath, root, removedAt: 1 } },
        }),
        shellRun: async (request) => isAtomicReplace(String(request?.command ?? ''))
          ? { exitCode: 1, stderr: { text: 'commit failed' } }
          : runNativeCommand(request),
      })
      apply(ctx as never)

      const response = await post(routes.get('/api/skill-manager')!, {
        method: 'reinstall',
        args: { sessionId: 'session-1', name: 'alpha' },
      })

      const moves = shellCommands.filter(isLifecycleMove)
      expect(response.status).toBe(500)
      expect(response.body.error).toContain('commit failed')
      expect(moves).toHaveLength(2)
      expect(moves[0]).toContain(trashedPath)
      expect(moves[0]).toContain(originalPath)
      expect(moves[1]).toContain(originalPath)
      expect(moves[1]).toContain(trashedPath)
      expect(existsSync(originalPath)).toBe(false)
      expect(readFileSync(join(trashedPath, 'SKILL.md'), 'utf8')).toBe('# alpha')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('reports both index and rollback errors when lifecycle recovery fails', async () => {
    let lifecycleMoves = 0
    const { ctx, routes } = hostContext({
      skill: {
        name: 'alpha',
        description: 'test skill',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'custom',
        provider: 'filesystem',
        content: '# alpha',
        path: '/workspace/skills/alpha/SKILL.md',
      },
      shellRun: async (request) => {
        const command = String(request?.command ?? '')
        if (isAtomicReplace(command)) return { exitCode: 1, stderr: { text: 'commit failed' } }
        if (isLifecycleMove(command)) {
          lifecycleMoves += 1
          if (lifecycleMoves === 2) return { exitCode: 1, stderr: { text: 'rollback failed' } }
        }
        return { exitCode: 0 }
      },
    })
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, {
      method: 'uninstall',
      args: { sessionId: 'session-1', name: 'alpha' },
    })

    expect(response.status).toBe(500)
    expect(response.body.error).toContain('commit failed')
    expect(response.body.error).toContain('rollback failed')
  })

  it('parses the real brief contract and keeps the report half read-only', async () => {
    const writes: Array<{ target: string; content: string }> = []
    const followups: unknown[] = []
    const { ctx, routes } = hostContext({
      writeText: async (target, content) => { writes.push({ target: String(target), content }) },
      followup: (message) => { followups.push(message) },
    })
    apply(ctx as never)
    const route = routes.get('/api/report')!

    const monthly = await post(route, { method: 'generateMonthly', args: { sessionId: 'session-1' } })
    expect(monthly.status).toBe(200)
    expect(monthly.body.lastError).toBe('')
    expect(monthly.body.projects).toEqual([
      // 周报/月报只要「作用 + 一句现状 + 待办 + 难点」，不再带实现细节。
      expect.objectContaining({ name: '管理插件', purpose: '管理技能', progress: '单包汇报' }),
    ])
    // 周报同形：都是「日期区间 + 每天有谁 + 每个项目一句现状」。
    const weekly = await post(route, { method: 'generateWeekly', args: { sessionId: 'session-1' } })
    expect(weekly.body.scope).toBe('weekly')
    expect(weekly.body.projects[0]).toEqual(expect.objectContaining({ name: '管理插件', progress: '单包汇报' }))

    // 汇报只剩两个只读视图：写入与 agent 触发都必须不存在。
    const exported = await post(route, { method: 'export', args: { sessionId: 'session-1', view: 'monthly' } })
    expect(exported.status).toBe(404)
    const reviewed = await post(route, { method: 'review', args: { sessionId: 'session-1' } })
    expect(reviewed.status).toBe(404)
    expect(writes).toEqual([])
    expect(followups).toEqual([])
  })

  it('serves weekly and monthly ranges with the latest progress per project', async () => {
    const date = currentDateKey()
    const brief = (progress: string) => `---\ndate: ${date}\n---\n\n# Brief\n\n## 管理插件\n- 作用：管理技能\n- 实现：单包\n- 今日进度：\n  1. ${progress}\n- 待办：\n  1. 补安装冒烟\n- 问题：\n  1. 定时未验证\n`
    const files = new Map<string, string>([[`reporter/brief/${date}.md`, brief('最新一句现状')]])
    const { ctx, routes } = hostContext({
      files,
      listDir: async () => [{ name: `${date}.md` }],
    })
    apply(ctx as never)
    const route = routes.get('/api/report')!

    const weekly = await post(route, { method: 'generateWeekly', args: { sessionId: 'session-1' } })
    expect(weekly.body.scope).toBe('weekly')
    expect(weekly.body.dates).toHaveLength(7)
    expect(weekly.body.dates).toContain(date)
    const project = weekly.body.projects.find((item: any) => item.name === '管理插件')
    expect(project.progress).toBe('最新一句现状')
    expect(project.todo).toEqual(['补安装冒烟'])
    expect(project.issues).toEqual(['定时未验证'])
    expect(project.days).toEqual([date])

    const monthly = await post(route, { method: 'generateMonthly', args: { sessionId: 'session-1' } })
    expect(monthly.body.scope).toBe('monthly')
    expect(monthly.body.dates.length).toBeGreaterThanOrEqual(28)
    expect(monthly.body.dates).toContain(date)
    expect(monthly.body.label).toBe(date.slice(0, 7))
  })

  it('treats a missing brief directory as an empty first-run report', async () => {
    const { ctx, routes } = hostContext({
      listDir: async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }) },
    })
    apply(ctx as never)

    const daily = await post(routes.get('/api/report')!, { method: 'generateDaily', args: { sessionId: 'session-1' } })

    expect(daily.status).toBe(200)
    expect(daily.body.projects).toEqual([])
    expect(daily.body.lastError).toBe('')
  })
})

