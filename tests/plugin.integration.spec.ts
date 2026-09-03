import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'

interface Route {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => unknown
}

function hostContext(options: { listDir?: () => Promise<Array<{ name?: string; path?: string }>> } = {}) {
  const routes = new Map<string, Route>()
  const services = new Map<string, unknown>()

  services.set('skills', {
    list: async () => [],
    get: async () => undefined,
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
      ? { session: { header: { cwd: '/workspace' } }, followup: () => undefined }
      : undefined,
  })
  services.set('fs', {
    resolve: async (path: string, options?: { cwd?: string }) => `${options?.cwd ?? ''}/${path}`,
    listDir: options.listDir ?? (async () => [{ name: '2026-09-03.md' }]),
    readText: async () => '---\ndate: 2026-09-03\n---\n\n# Brief\n\n## 管理插件\n- 作用：管理技能\n- 实现：host + client\n- 今日进度：\n  1. 单包汇报\n- 待办：\n- 问题：\n',
    writeText: async () => undefined,
  })
  services.set('shell', { resolve: (request: unknown) => request, run: async () => ({ exitCode: 0 }) })
  services.set('sandboxPolicy', { workspaceRoot: '/workspace', resolve: () => ({}) })

  const ctx = {
    get(name: string) { return services.get(name) },
    effect(setup: () => unknown) { setup() },
  }
  return { ctx, routes }
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
