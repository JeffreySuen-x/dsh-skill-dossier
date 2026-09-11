/**
 * 技能方向分类的单一事实源：canonical 10 类 + 每类的易变性。host 与 client
 * 都从这里 import，避免两处硬编码漂移。
 *
 * 「方向」是档案的分类轴，也是保鲜复审的输入之一：易变方向（volatility=high）
 * 的内容更容易过时，复审优先级更高。检索不在这里——DSH 把技能目录
 * （name + description）直接放进系统提示，由模型自己选，本插件不再做词法路由。
 */
/** 一个方向分类的元数据。 */
export interface Direction {
    /** 中文方向名（也是归档 direction 字段的唯一合法取值）。 */
    label: string;
    /** 一句话说明该方向覆盖什么（UI 上作为标签提示）。 */
    description: string;
    /** 领域易变性：high = 内容易过时，复审优先级高。 */
    volatility: 'high' | 'low';
}
/** canonical 10 类（顺序即 UI 展示顺序）。 */
export declare const DIRECTIONS: readonly Direction[];
/** 全部方向名（工具描述与 UI 里用）。 */
export declare const DIRECTION_LABELS: readonly string[];
/** 判断一个字符串是否为合法方向名。 */
export declare function isDirectionLabel(label: string): boolean;
/** 方向名 → 一句话说明（UI 标签提示）。 */
export declare const DIRECTION_HINTS: Readonly<Record<string, string>>;
//# sourceMappingURL=directions.d.ts.map