/** 列表页分类值：「全部」。 */
export declare const ALL_FILTER = "all";
/** 列表页分类值：「未建档」。 */
export declare const UNPROFILED_FILTER = "unprofiled";
/** 一个分类 chip：值唯一，计数为当前目录里命中该分类的技能数。 */
export interface SkillFilterChip {
    value: string;
    label: string;
    count: number;
}
/** 技能条目里本模块关心的字段。 */
export interface FilterableSkill {
    name: string;
    direction: string | undefined;
}
/** 是否已建档：方向是非空字符串——与 host 写档案时的校验口径一致。 */
export declare function isProfiledSkill(direction: string | undefined): boolean;
/** 判断一个技能是否命中分类值；未知分类值一律不命中。 */
export declare function skillMatchesFilter(filter: string, direction: string | undefined): boolean;
/**
 * 技能目录页的分类 chip：全部、未建档，以及**当前目录里确实有技能**的方向
 * （按 canonical 顺序）。空方向不出现——这里给的是当前目录的分类，不是分类总表。
 */
export declare function skillFilterChips(skills: readonly FilterableSkill[]): SkillFilterChip[];
//# sourceMappingURL=skill-filter.d.ts.map