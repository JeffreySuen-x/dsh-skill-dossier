/**
 * 技能调用使用统计：把一次调用折叠进按技能分组的记录，按天聚合、
 * 计算频率。纯函数、无 I/O，便于单测。
 */
/** 单个技能的调用统计。 */
export interface UsageRecord {
    /** 累计调用次数。 */
    count: number;
    /** 首次调用时间戳（ms）。 */
    firstUsedAt: number;
    /** 最近一次调用时间戳（ms）。 */
    lastUsedAt: number;
    /** 'YYYY-MM-DD'（本地时区）→ 当天调用次数。 */
    daily: Record<string, number>;
    /** 最近 {@link RECENT_CAP} 次调用的时间戳，按发生顺序（末尾最新）。 */
    recent: number[];
}
/** recent 数组保留的最大条数，防止长期累积撑大 index.json。 */
export declare const RECENT_CAP = 20;
/** 本地时区的 'YYYY-MM-DD' 键。 */
export declare function dayKey(at: number): string;
/**
 * 把一次调用折叠进 usage 表（原地修改），返回被更新的记录。
 * @param usage 按技能名分组的调用统计（可空表）。
 * @param name 技能名（kebab-case）。
 * @param at 本次调用时间戳（ms）。
 */
export declare function recordUsage(usage: Record<string, UsageRecord>, name: string, at: number): UsageRecord;
/** 一个技能的聚合统计（供展示/文本渲染）。 */
export interface UsageSummary {
    name: string;
    count: number;
    firstUsedAt: number;
    lastUsedAt: number;
    /** 有调用记录的不同天数。 */
    activeDays: number;
    /** 平均每天调用次数（count / activeDays，保留 1 位小数）。 */
    callsPerDay: number;
    /** 距最近一次调用的整天数。 */
    lastUsedDaysAgo: number;
}
/**
 * 把整张 usage 表聚合成按调用次数降序的摘要列表。
 * @param usage 按技能名分组的调用统计。
 * @param now 当前时间戳（ms），用于计算 lastUsedDaysAgo。
 */
export declare function summarizeUsage(usage: Record<string, UsageRecord>, now: number): UsageSummary[];
/**
 * 把调用统计渲染成给模型看的一行一条的紧凑文本。
 * @param usage 按技能名分组的调用统计。
 * @param name 只看某个技能；省略则列出所有被调用过的技能。
 * @param now 当前时间戳（ms）。
 */
export declare function formatUsage(usage: Record<string, UsageRecord>, name: string | undefined, now: number): string;
/**
 * 从一段用户文本里提取 /name 手势命中的技能名（去重、保序）。
 * @param text 用户输入的纯文本。
 */
export declare function skillGestures(text: string): string[];
//# sourceMappingURL=usage.d.ts.map