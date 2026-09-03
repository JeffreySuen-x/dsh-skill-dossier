import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'

interface Route {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => unknown
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
  skill?: {
    name: string
    description: string
    invocation: { modelInvocable: boolean; userInvocable: boolean }
    source: string
    provider: string
    content: string
    path?: string
  }
} = {}) {
  const routes = new Map<string, Route>()
  const services = new Map<string, unknown>()
  const today = currentDateKey()
  const shellCommands: string[] = []
  const cwd = options.cwd ?? '/workspace'

  services.set('skills', {
    list: async () => options.skill === undefined ? [] : [options.skill],
    get: async (name: string) => name === options.skill?.name ? options.skill : undefined,
    register: () => () => undefined,
  })
  services.set('tools', { register: () => () => undefined })
  services.set('webServer', {
    register(route: Route) {
      if (routes.has(route.path)) throw new Error(`duplicate route: ${route.path}`)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  })
  services.set('agents', {
    get: (id: string) => id === 'session-1'
      ? { session: { header: { cwd } }, followup: options.followup ?? (() => undefined) }
      : undefined,
  })
  services.set('fs', {
    resolve: async (path: string, options?: { cwd?: string }) => `${options?.cwd ?? ''}/${path}`,
    listDir: options.listDir ?? (async () => [{ name: `${today}.md` }]),
    readText: async (target: unknown) => {
      if (String(target).endsWith('/.dsh/skill-manager/index.json')) {
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
    effect(setup: () => unknown) { setup() },
  }
  return { ctx, routes, shellCommands }
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
    expect(writes[0]).toMatch(/\/\.dsh\/skill-manager\/\.index\.json\..+\.tmp$/)
    expect(shellCommands.some((command) => command.startsWith('mv -f -- '))).toBe(true)
    expect(shellCommands.some((command) => command.endsWith("'/workspace/.dsh/skill-manager/index.json'"))).toBe(true)
  })

  it('reports atomic replacement failure and attempts to clean the temporary file', async () => {
    const writes: string[] = []
    const { ctx, routes, shellCommands } = hostContext({
      writeText: async (target) => { writes.push(String(target)) },
      shellRun: async (request) => String(request?.command ?? '').startsWith('mv -f -- ')
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
    expect(shellCommands.some((command) => command.startsWith('rm -f -- '))).toBe(true)
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
    expect(shellCommands.some((command) => command.startsWith('rm -f -- '))).toBe(true)
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
    const { ctx, routes, shellCommands } = hostContext({
      skill: {
        name: 'alpha',
        description: 'test skill',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'custom',
        provider: 'filesystem',
        content: '# alpha',
        path: '/workspace/skills/alpha/SKILL.md',
      },
      shellRun: async (request) => String(request?.command ?? '').startsWith('mv -f -- ')
        ? { exitCode: 1, stderr: { text: 'commit failed' } }
        : { exitCode: 0 },
    })
    apply(ctx as never)

    const response = await post(routes.get('/api/skill-manager')!, {
      method: 'uninstall',
      args: { sessionId: 'session-1', name: 'alpha' },
    })

    const moves = shellCommands.filter((command) => command.includes('mv -n -- '))
    expect(response.status).toBe(500)
    expect(response.body.error).toContain('commit failed')
    expect(moves).toHaveLength(2)
    expect(moves[0]).toMatch(/mv -n -- '\/workspace\/skills\/alpha' '\/workspace\/skill-manager\/trash\/alpha-\d+'/)
    expect(moves[1]).toMatch(/mv -n -- '\/workspace\/skill-manager\/trash\/alpha-\d+' '\/workspace\/skills\/alpha'/)
  })

  it('moves a reinstalled skill back to trash when the index commit fails', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-skill-manager-reinstall-'))
    const root = join(base, 'skills')
    const trashDir = join(base, 'skill-manager', 'trash')
    const trashedPath = join(trashDir, 'alpha-1')
    const originalPath = join(root, 'alpha')
    mkdirSync(trashedPath, { recursive: true })
    try {
      const { ctx, routes, shellCommands } = hostContext({
        cwd: base,
        indexText: JSON.stringify({
          version: 1,
          skills: {},
          usage: {},
          trash: { alpha: { name: 'alpha', originalPath, trashedPath, root, removedAt: 1 } },
        }),
        shellRun: async (request) => String(request?.command ?? '').startsWith('mv -f -- ')
          ? { exitCode: 1, stderr: { text: 'commit failed' } }
          : { exitCode: 0 },
      })
      apply(ctx as never)

      const response = await post(routes.get('/api/skill-manager')!, {
        method: 'reinstall',
        args: { sessionId: 'session-1', name: 'alpha' },
      })

      const moves = shellCommands.filter((command) => command.includes('mv -n -- '))
      expect(response.status).toBe(500)
      expect(response.body.error).toContain('commit failed')
      expect(moves).toHaveLength(2)
      expect(moves[0]).toContain(`mv -n -- '${trashedPath}' '${originalPath}'`)
      expect(moves[1]).toContain(`mv -n -- '${originalPath}' '${trashedPath}'`)
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
        if (command.startsWith('mv -f -- ')) return { exitCode: 1, stderr: { text: 'commit failed' } }
        if (command.includes('mv -n -- ')) {
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
