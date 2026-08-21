/**
 * 技能匹配：给定当前任务的一句话描述，从已建档技能中按确定性评分选出
 * 最相关的若干条，把候选收窄到短名单；最终语义判断交给模型。
 *
 * 评分是朴素的文本启发式：方向关键词命中 + 字符二元组重叠 + 技能名
 * 词元命中。它不追求语义精确，只负责「把明显相关的排在前面」。
 */
/** 建档技能档案里参与匹配的最小字段集。 */
export interface SkillProfile {
    name: string;
    direction?: string;
    useScope?: string;
    boundaries?: string;
    scenarios?: string;
    notes?: string;
}
/** 一条匹配结果（已把长字段截短，供模型阅读）。 */
export interface SkillMatch {
    name: string;
    direction: string;
    useScope: string;
    scenarios: string;
    score: number;
    matched: string[];
}
/** 匹配选项。 */
export interface MatchOptions {
    topK: number;
    direction?: string;
}
/**
 * 给单条技能档案打分，并附带命中的理由标签。
 * @param query 当前任务的一句话描述
 * @param profile 建档档案
 * @param extraText 额外参与重叠的文本（通常是注册表里的 description/whenToUse）
 */
export declare function scoreSkill(query: string, profile: SkillProfile, extraText?: string): SkillMatch;
/**
 * 对建档技能排序并取前 topK 条（可选按方向过滤）。
 * @param query 当前任务的一句话描述
 * @param profiles 建档档案列表
 * @param options 匹配选项
 * @param extraText 技能名 → 额外文本（注册表描述等），缺省为空
 */
export declare function matchSkills(query: string, profiles: SkillProfile[], options: MatchOptions, extraText?: Map<string, string>): SkillMatch[];
/**
 * 把匹配结果渲染成给模型看的一行一条的紧凑文本。
 * @param matches 匹配结果
 * @param total 建档技能总数
 * @param query 原始任务描述
 */
export declare function formatMatches(matches: SkillMatch[], total: number, query: string): string;
//# sourceMappingURL=match.d.ts.map