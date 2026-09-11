import type { UsageRecord } from './usage.ts';
export interface IndexEntry {
    name: string;
    direction?: string;
    useScope?: string;
    boundaries?: string;
    scenarios?: string;
    notes?: string;
    origin?: 'self' | 'external' | 'system' | 'unknown';
    updatedAt?: number;
    reviewedAt?: number;
    contentHash?: string;
    /** 实测调用结果（来自 tools/result 的观察，不是模型自述）：加载成功/失败次数。 */
    outcomes?: {
        loaded: number;
        failed: number;
        lastAt: number;
        lastError?: string;
    };
}
export interface TrashRecord {
    name: string;
    originalPath: string;
    trashedPath: string;
    root: string;
    removedAt: number;
}
export interface ArchiveIndex {
    version: 1;
    skills: Record<string, IndexEntry>;
    trash: Record<string, TrashRecord>;
    usage: Record<string, UsageRecord>;
}
export interface IndexStorage {
    lockKey?(cwd: string): string | Promise<string>;
    read(cwd: string): Promise<string>;
    writeAtomic(cwd: string, value: string): Promise<void>;
}
export interface IndexStore {
    read(cwd: string | undefined): Promise<ArchiveIndex>;
    update<T>(cwd: string, mutate: (index: ArchiveIndex) => T | Promise<T>, recoverWriteFailure?: (error: unknown) => void | Promise<void>): Promise<T>;
}
export declare function emptyArchiveIndex(): ArchiveIndex;
export declare function parseArchiveIndex(text: string): ArchiveIndex;
/** A per-workspace serialized read/modify/atomic-write store. */
export declare function createIndexStore(storage: IndexStorage): IndexStore;
//# sourceMappingURL=index-store.d.ts.map