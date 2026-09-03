import type { UsageRecord } from './usage.ts'

export interface IndexEntry {
  name: string
  direction?: string
  useScope?: string
  boundaries?: string
  scenarios?: string
  notes?: string
  origin?: 'self' | 'external' | 'system' | 'unknown'
  updatedAt?: number
  reviewedAt?: number
  contentHash?: string
  evaluation?: {
    score: number | null
    judgedAt: number
    baselineDelta: string | null
    conclusion: '有效' | '无效' | '待评测'
  }
}

export interface TrashRecord {
  name: string
  originalPath: string
  trashedPath: string
  root: string
  removedAt: number
}

export interface ArchiveIndex {
  version: 1
  skills: Record<string, IndexEntry>
  trash: Record<string, TrashRecord>
  usage: Record<string, UsageRecord>
}

export interface IndexStorage {
  lockKey?(cwd: string): string | Promise<string>
  read(cwd: string): Promise<string>
  writeAtomic(cwd: string, value: string): Promise<void>
}

export interface IndexStore {
  read(cwd: string | undefined): Promise<ArchiveIndex>
  update<T>(cwd: string, mutate: (index: ArchiveIndex) => T | Promise<T>): Promise<T>
}

export function emptyArchiveIndex(): ArchiveIndex {
  return { version: 1, skills: {}, trash: {}, usage: {} }
}

function recordField<T>(value: unknown, field: string): Record<string, T> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`索引文件损坏：${field} 必须是对象`)
  }
  return value as Record<string, T>
}

export function parseArchiveIndex(text: string): ArchiveIndex {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`索引文件损坏：JSON 无法解析（${message}）`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('索引文件损坏：根结构必须是对象')
  }
  const value = parsed as { version?: unknown; skills?: unknown; trash?: unknown; usage?: unknown }
  if (value.version !== undefined && value.version !== 1) {
    throw new Error(`索引文件损坏：不支持版本 ${String(value.version)}`)
  }
  return {
    version: 1,
    skills: recordField<IndexEntry>(value.skills, 'skills'),
    trash: recordField<TrashRecord>(value.trash, 'trash'),
    usage: recordField<UsageRecord>(value.usage, 'usage'),
  }
}

function isMissingFile(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

/** A per-workspace serialized read/modify/atomic-write store. */
export function createIndexStore(storage: IndexStorage): IndexStore {
  const barriers = new Map<string, Promise<void>>()

  async function load(cwd: string): Promise<ArchiveIndex> {
    try {
      return parseArchiveIndex(await storage.read(cwd))
    } catch (error) {
      if (isMissingFile(error)) return emptyArchiveIndex()
      throw error
    }
  }

  function enqueue<T>(cwd: string, task: () => Promise<T>): Promise<T> {
    const previous = barriers.get(cwd) ?? Promise.resolve()
    const result = previous.then(task, task)
    const barrier = result.then(() => undefined, () => undefined)
    barriers.set(cwd, barrier)
    void barrier.then(() => {
      if (barriers.get(cwd) === barrier) barriers.delete(cwd)
    })
    return result
  }

  return {
    async read(cwd) {
      if (cwd === undefined) return emptyArchiveIndex()
      const key = await (storage.lockKey?.(cwd) ?? cwd)
      await (barriers.get(key) ?? Promise.resolve())
      return load(cwd)
    },
    async update(cwd, mutate) {
      const key = await (storage.lockKey?.(cwd) ?? cwd)
      return enqueue(key, async () => {
        const index = await load(cwd)
        const result = await mutate(index)
        await storage.writeAtomic(cwd, JSON.stringify(index, null, 2))
        return result
      })
    },
  }
}
