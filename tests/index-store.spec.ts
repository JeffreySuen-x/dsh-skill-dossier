import { describe, expect, it } from 'vitest'
import { createIndexStore, parseArchiveIndex } from '../src/index-store.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const writes: string[] = []
  return {
    files,
    writes,
    storage: {
      async read(cwd: string) {
        const text = files.get(cwd)
        if (text === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return text
      },
      async writeAtomic(cwd: string, value: string) {
        writes.push(cwd)
        files.set(cwd, value)
      },
    },
  }
}

describe('index store', () => {
  it('serializes concurrent updates in one workspace without losing fields', async () => {
    const memory = memoryStorage()
    const store = createIndexStore(memory.storage)

    await Promise.all([
      store.update('/a', async (index) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        index.skills.alpha = { name: 'alpha' }
      }),
      store.update('/a', async (index) => {
        index.skills.beta = { name: 'beta' }
      }),
    ])

    expect((await store.read('/a')).skills).toEqual({ alpha: { name: 'alpha' }, beta: { name: 'beta' } })
    expect(memory.writes).toEqual(['/a', '/a'])
  })

  it('serializes distinct cwd spellings that resolve to one physical workspace', async () => {
    let text: string | undefined
    const store = createIndexStore({
      lockKey: async (cwd) => cwd.replace(/\/\.$/, ''),
      read: async () => {
        if (text === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return text
      },
      writeAtomic: async (_cwd, value) => { text = value },
    })

    await Promise.all([
      store.update('/a', async (index) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        index.skills.alpha = { name: 'alpha' }
      }),
      store.update('/a/.', (index) => { index.skills.beta = { name: 'beta' } }),
    ])

    expect((await store.read('/a')).skills).toEqual({ alpha: { name: 'alpha' }, beta: { name: 'beta' } })
  })

  it('keeps workspaces independent', async () => {
    const memory = memoryStorage()
    const store = createIndexStore(memory.storage)

    await Promise.all([
      store.update('/a', (index) => { index.skills.alpha = { name: 'alpha' } }),
      store.update('/b', (index) => { index.skills.beta = { name: 'beta' } }),
    ])

    expect(Object.keys((await store.read('/a')).skills)).toEqual(['alpha'])
    expect(Object.keys((await store.read('/b')).skills)).toEqual(['beta'])
  })

  it('returns an empty index only for a missing file', async () => {
    const store = createIndexStore(memoryStorage().storage)
    await expect(store.read('/missing')).resolves.toEqual({ version: 1, skills: {}, trash: {}, usage: {} })

    const denied = createIndexStore({
      read: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) },
      writeAtomic: async () => undefined,
    })
    await expect(denied.read('/a')).rejects.toThrow('denied')
  })

  it('rejects malformed JSON and invalid root records', () => {
    expect(() => parseArchiveIndex('{oops')).toThrow('索引文件损坏')
    expect(() => parseArchiveIndex('[]')).toThrow('索引文件损坏')
    expect(() => parseArchiveIndex('{"skills":[]}')).toThrow('索引文件损坏')
  })

  it('does not retry or hide an atomic write failure', async () => {
    const memory = memoryStorage({ '/a': '{"version":1,"skills":{},"trash":{},"usage":{}}' })
    const store = createIndexStore({
      read: memory.storage.read,
      writeAtomic: async () => { throw new Error('replace failed') },
    })

    await expect(store.update('/a', (index) => { index.skills.alpha = { name: 'alpha' } })).rejects.toThrow('replace failed')
    expect(JSON.parse(memory.files.get('/a')!)).toEqual({ version: 1, skills: {}, trash: {}, usage: {} })
  })

  it('keeps write-failure recovery inside the workspace serial section', async () => {
    const order: string[] = []
    let stored = '{"version":1,"skills":{},"trash":{},"usage":{}}'
    let failNextWrite = true
    const store = createIndexStore({
      read: async () => stored,
      writeAtomic: async (_cwd, value) => {
        if (failNextWrite) {
          failNextWrite = false
          order.push('write-failed')
          throw new Error('replace failed')
        }
        order.push('write-succeeded')
        stored = value
      },
    })

    const first = store.update(
      '/a',
      (index) => {
        order.push('first-mutate')
        index.skills.alpha = { name: 'alpha' }
      },
      async () => {
        order.push('recovery-start')
        await new Promise((resolve) => setTimeout(resolve, 10))
        order.push('recovery-end')
      },
    )
    const second = store.update('/a', (index) => {
      order.push('second-mutate')
      index.skills.beta = { name: 'beta' }
    })

    await expect(first).rejects.toThrow('replace failed')
    await expect(second).resolves.toBeUndefined()
    expect(order).toEqual([
      'first-mutate',
      'write-failed',
      'recovery-start',
      'recovery-end',
      'second-mutate',
      'write-succeeded',
    ])
  })

  // 回归：回滚（真调用方里是 `await runShell(...)` 的移动回来）自己失败时，
  // 不能把原始写盘错误顶掉——调用方要靠它判断「索引没写进去」，那是两件事。
  it('reports the original write failure even when recovery itself throws', async () => {
    const store = createIndexStore({
      read: async () => '{"version":1,"skills":{},"trash":{},"usage":{}}',
      writeAtomic: async () => { throw new Error('replace failed') },
    })

    const failure = await store
      .update(
        '/a',
        (index) => { index.skills.alpha = { name: 'alpha' } },
        async () => { throw new Error('rollback failed') },
      )
      .catch((error: unknown) => error as Error)

    expect(failure.message).toContain('replace failed')
    expect(failure.message).toContain('rollback failed')
  })
})
