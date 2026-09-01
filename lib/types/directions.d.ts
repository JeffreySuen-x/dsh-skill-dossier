/**
 * 技能方向分类的单一事实源：canonical 10 类 + 每类元数据（描述/示例/
 * 易变性/分类关键词）。host 与 client 都从这里 import，避免两处硬编码漂移。
 *
 * 「方向」是「先分类再检索」的第一段：先用关键词命中判方向（粗、容易），
 * 再在方向内检索（细、候选少）。易变性（volatility）供保鲜复审排优先级。
 */
/** 一个方向分类的完整元数据。 */
export interface Direction {
    /** 中文方向名（也是归档 direction 字段的唯一合法取值）。 */
    label: string;
    /** 一句话说明该方向覆盖什么。 */
    description: string;
    /** 代表性技能名（给模型/UI 做示例）。 */
    examples: string[];
    /** 领域易变性：high = 内容易过时，复审优先级高。 */
    volatility: 'high' | 'low';
    /** 分类关键词：命中则给该方向投票。 */
    keywords: string[];
}
/** canonical 10 类（顺序即 UI 展示顺序）。 */
export declare const DIRECTIONS: readonly Direction[];
/** 全部方向名（工具描述与 UI 里用）。 */
export declare const DIRECTION_LABELS: readonly string[];
/** 判断一个字符串是否为合法方向名。 */
export declare function isDirectionLabel(label: string): boolean;
/** 用关键词表给 query 命中的方向投票（先分类的第一步，可命中多个）。 */
export declare function detectDirections(query: string): string[];
//# sourceMappingURL=directions.d.ts.map