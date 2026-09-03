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
  writeText?: (target: unknown, content: string) => Promise<void>
  followup?: (message: unknown) => void
  indexText?: string
  indexReadError?: Error
  shellRun?: (request: any) => Promise<{ exitCode: number; stderr?: { text?: string } }>
  skill?: FakeSkill
} = {}) {
  const routes = new Map<string, Route>()
  const services = new Map<string, unknown>()
  const today = currentDateKey()
  const shellCommands: string[] = []
  const cwd = options.cwd ?? (process.platform === 'win32' ? 'C:\\workspace' : '/workspace')
  const globalRuntime = new Map<string, FakeSkill>()
  const sessionRuntime = new Map<string, Map<string, FakeSkill>>()
  const sessionDisposers = new Map<string, Set<() => void>>()
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
    list: async (view?: unknown) => visibleSkills(sessionIdOf(view)),
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
          const dispose = setup()
          if (typeof dispose === 'function') disposers.add(dispose as () => void)
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
      if (String(target).replaceAll('\\', '/').endsWith('/.dsh/skill-manager/index.json')) {
        if (options.indexReadError !== undefined) throw options.indexReadError
        if (options.indexText === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return options.indexText
      }
      return `---\ndate: ${today}\n---\n\n# Brief\n\n## 管理插件\n- 作用：管理技能\n- 实现：host + client\n- 今日进度：\n  1. 单包汇报\n- 待办：\n- 问题：\n`
    },
    writeText: options.writeText ?? (async () => undefined),
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
    effect(setup: () => unknown) {
      const dispose = setup()
      if (typeof dispose === 'function') pluginDisposers.add(dispose as () => void)
      return dispose
    },
  }
  return {
    ctx,
    routes,
    shellCommands,
    disposeSession(id: string) {
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

  it('isolates temporary skills and ownership between sessions', async () => {
    const { ctx, routes } = hostContext()
    apply(ctx as never)
    const route = routes.get('/api/skill-manager')!

    const first = await post(route, {
      method: 'register',
      args: { sessionId: 'session-1', name: 'same-name', description: 'First', content: 'first body' },
    })
    const second = await post(route, {
      method: 'register',
      args: { sessionId: 'session-2', name: 'same-name', description: 'Second', content: 'second body' },
    })

    expect(first.body).toEqual({ ok: true })
    expect(second.body).toEqual({ ok: true })
    expect((await post(route, { method: 'get', args: { sessionId: 'session-1', name: 'same-name' } })).body.content).toBe('first body')
    expect((await post(route, { method: 'get', args: { sessionId: 'session-2', name: 'same-name' } })).body.content).toBe('second body')

    await post(route, {
      method: 'register',
      args: { sessionId: 'session-1', name: 'first-only', description: 'First only', content: 'private body' },
    })
    expect((await post(route, { method: 'get', args: { sessionId: 'session-2', name: 'first-only' } })).body).toBeNull()
    expect((await post(route, { method: 'unregister', args: { sessionId: 'session-2', name: 'first-only' } })).body)
      .toEqual({ ok: false, error: '该技能不是本会话注册的临时技能' })
    expect((await post(route, { method: 'get', args: { sessionId: 'session-1', name: 'first-only' } })).body.content).toBe('private body')
  })

  it('rejects temporary registration without a live session', async () => {
    const { ctx, routes } = hostContext()
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, {
      method: 'register',
      args: { name: 'global-leak', description: 'Must not leak', content: 'body' },
    })

    expect(response.body).toEqual({ ok: false, error: '当前会话没有活跃的 agent' })
  })

  it('does not let a session-owned registration replace a discovered skill', async () => {
    const { ctx, routes } = hostContext({
      skill: {
        name: 'installed-skill',
        description: 'Installed',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'project-dsh',
        provider: 'filesystem',
        content: 'installed body',
      },
    })
    apply(ctx as never)
    const route = routes.get('/api/skill-manager')!

    const response = await post(route, {
      method: 'register',
      args: { sessionId: 'session-1', name: 'installed-skill', description: 'Override', content: 'override body' },
    })

    expect(response.body).toEqual({ ok: false, error: '同名技能 "installed-skill" 已存在' })
    expect((await post(route, { method: 'get', args: { sessionId: 'session-1', name: 'installed-skill' } })).body.content)
      .toBe('installed body')
  })

  it('serializes same-session replacement and unregisters the winning registration', async () => {
    const { ctx, routes } = hostContext()
    apply(ctx as never)
    const route = routes.get('/api/skill-manager')!

    const [first, second] = await Promise.all([
      post(route, {
        method: 'register',
        args: { sessionId: 'session-1', name: 'racing-skill', description: 'First', content: 'first body' },
      }),
      post(route, {
        method: 'register',
        args: { sessionId: 'session-1', name: 'racing-skill', description: 'Second', content: 'second body' },
      }),
    ])

    expect(first.body).toEqual({ ok: true })
    expect(second.body).toEqual({ ok: true })
    expect((await post(route, { method: 'get', args: { sessionId: 'session-1', name: 'racing-skill' } })).body.content).toBe('second body')
    expect((await post(route, { method: 'unregister', args: { sessionId: 'session-1', name: 'racing-skill' } })).body).toEqual({ ok: true })
    expect((await post(route, { method: 'get', args: { sessionId: 'session-1', name: 'racing-skill' } })).body).toBeNull()
  })

  it('lets agent-scope disposal remove its temporary skill registrations', async () => {
    const { ctx, routes, disposeSession, sessionSkillNames } = hostContext()
    apply(ctx as never)
    const route = routes.get('/api/skill-manager')!
    await post(route, {
      method: 'register',
      args: { sessionId: 'session-1', name: 'short-lived', description: 'Temporary', content: 'body' },
    })
    expect(sessionSkillNames('session-1')).toEqual(['short-lived'])

    disposeSession('session-1')

    expect(sessionSkillNames('session-1')).toEqual([])
    expect((await post(route, {
      method: 'unregister',
      args: { sessionId: 'session-1', name: 'short-lived' },
    })).body).toEqual({ ok: false, error: '当前会话没有活跃的 agent' })
  })

  it('disposes temporary skills from every live session when the plugin stops', async () => {
    const { ctx, routes, disposePlugin, sessionSkillNames } = hostContext()
    apply(ctx as never)
    const route = routes.get('/api/skill-manager')!
    for (const sessionId of ['session-1', 'session-2']) {
      await post(route, {
        method: 'register',
        args: { sessionId, name: 'plugin-owned', description: 'Temporary', content: sessionId },
      })
      expect(sessionSkillNames(sessionId)).toEqual(['plugin-owned'])
    }

    disposePlugin()

    expect(sessionSkillNames('session-1')).toEqual([])
    expect(sessionSkillNames('session-2')).toEqual([])
    expect(routes.size).toBe(0)
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

  it('moves an uninstalled skill back when the index commit fails', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-skill-manager-uninstall-'))
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
    const base = mkdtempSync(join(tmpdir(), 'dsh-skill-manager-reinstall-'))
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

  it('generates monthly data, exports both formats, and reviews the actual brief contract', async () => {
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
      expect.objectContaining({ name: '管理插件', progress: ['单包汇报'] }),
    ])

    const exported = await post(route, { method: 'export', args: { sessionId: 'session-1', view: 'monthly' } })
    expect(exported.body).toEqual(expect.objectContaining({ ok: true }))
    expect(writes.map((write) => write.target).sort()).toEqual([
      expect.stringMatching(/report-monthly-\d{4}-\d{2}\.json$/),
      expect.stringMatching(/report-monthly-\d{4}-\d{2}\.md$/),
    ])
    expect(writes.some((write) => write.content.includes('单包汇报'))).toBe(true)

    const reviewed = await post(route, { method: 'review', args: { sessionId: 'session-1' } })
    expect(reviewed.body).toEqual(expect.objectContaining({ ok: true }))
    expect(JSON.stringify(followups)).toContain('reporter/brief/ 目录下所有 YYYY-MM-DD.md')
    expect(JSON.stringify(followups)).not.toContain('brief-YYYY-MM-DD.md')
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
