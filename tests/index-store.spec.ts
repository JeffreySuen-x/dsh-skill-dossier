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
})
