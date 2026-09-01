import type { UsageRecord } from './usage.ts';
/** 一条待复审候选。 */
export interface ReviewEntry {
    name: string;
    direction: string;
    volatility: 'high' | 'low';
    /** 距上次使用的天数；null = 从未使用。 */
    daysSinceUse: number | null;
    /** 距上次复审的天数；null = 从未复审。 */
    daysSinceReviewed: number | null;
    /** 命中理由（中文标签）。 */
    reasons: string[];
    /** 优先级，越高越该复审。 */
    priority: number;
}
/** 参与排序的最小档案字段集。 */
interface ReviewSkill {
    name: string;
    direction?: string;
    reviewedAt?: number;
}
/**
 * 计算待复审候选并按优先级降序取前 topK 条。
 * @param skills 已建档技能（含 direction / reviewedAt）。
 * @param usage 调用统计。
 * @param now 当前时间戳（ms）。
 * @param topK 返回条数。
 */
export declare function reviewCandidates(skills: Record<string, ReviewSkill>, usage: Record<string, UsageRecord>, now: number, topK: number): ReviewEntry[];
/**
 * 把待复审候选渲染成给模型看的一行一条的紧凑文本。
 */
export declare function formatReview(entries: ReviewEntry[], total: number): string;
export {};
//# sourceMappingURL=freshness.d.ts.map