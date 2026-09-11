/**
 * 汇报的纯逻辑层：配置归一化、复盘提示词、结构化产物契约、brief 回写。
 *
 * 这里刻意不碰 I/O 与宿主服务——可测、可在客户端复用，也让 report.ts 只负责
 * 「取会话、发提示词、读写文件」。所有默认值与原行为一致：不配置就等于没改。
 */
/** 汇报的可配置契约（全部有默认值，缺省即旧行为）。 */
export interface ReportConfig {
    /** 数据根目录（相对于工作区）。 */
    dataRoot: string;
    /** 每日简报目录名（dataRoot 之下）。 */
    briefDir: string;
    /** 复盘产物目录名（dataRoot 之下）。 */
    reviewDir: string;
    /** 导出目录名（dataRoot 之下）。 */
    exportDir: string;
    /** 复盘按名加载的 skill；为空则只用内联步骤。 */
    reviewSkill: string;
    /** 复盘执行位置：当前会话，或让 agent 派给子代理。 */
    dispatch: 'session' | 'subagent';
    /** 定时复盘（默认关闭；只在 DSH 进程存活期间生效）。 */
    schedule: {
        enabled: boolean;
        hour: number;
        checkMinutes: number;
    };
    /** 单次复盘等待产物落盘的上限（毫秒）。 */
    runTimeoutMs: number;
}
/** 复盘结构化产物的固定形状（键名与 report.ts 的校验一致）。 */
export interface ReviewReport {
    period: string;
    projects: string[];
    completed: string[];
    learnings: string[];
    next: string[];
    openQuestions: string[];
    sourceBriefs: string[];
}
export declare const DEFAULT_REPORT_CONFIG: ReportConfig;
/**
 * 归一化插件 config：任何缺失/非法字段都退回默认值，绝不因为一处配置写错
 * 就让汇报整块不可用（DSH 的 patch 层是整体替换 config，不是合并）。
 */
export declare function normalizeReportConfig(raw: unknown): ReportConfig;
/** 复盘产物的路径（相对于工作区）。 */
export declare function reviewArtifacts(config: ReportConfig, date: string): {
    markdown: string;
    json: string;
    directory: string;
};
/**
 * 复盘提示词：优先按名加载 skill，同时把内联步骤写全作为回退——skill 未安装
 * 或其依赖（如 aeon_* MCP 工具）未挂载时，这一步仍然能跑完，不会把一个能用
 * 的按钮变成静默空操作。
 */
export declare function buildReviewPrompt(options: {
    config: ReportConfig;
    date: string;
    dispatch: 'session' | 'subagent';
}): string;
/** 把模型产出的 JSON 文本收成对象：容忍 ```json 围栏与前后废话。 */
export declare function extractJsonObject(raw: string): unknown;
/**
 * 校验复盘结构化产物：七个键全部必填、只允许这七个、值类型正确。
 * 不通过就让面板回退到 markdown——契约漂移不该把一次成功的复盘变成白屏。
 */
export declare function validateReviewReport(raw: unknown): {
    ok: true;
    value: ReviewReport;
} | {
    ok: false;
    error: string;
};
/** brief 的回写字段（与 brief skill 的契约一致）：条目是纯文本，编号由本函数生成。 */
export interface BriefItems {
    progress?: string[];
    todo?: string[];
    issues?: string[];
}
/**
 * 只追加、不改写：在 `## <project>` 区块内把条目追加到对应小节末尾，编号接续
 * 已有条目。区块或小节不存在就补建；已有正文一行都不动——回写简报最怕的就是
 * 覆盖掉人自己记的东西。
 */
export declare function appendBriefItems(text: string, project: string, items: BriefItems): string;
/** 该简报是否已经过去重后的可复盘内容（定时触发前的一次便宜检查）。 */
export declare function briefHasProgress(projects: Array<{
    progress: string[];
}>): boolean;
//# sourceMappingURL=report-runs.d.ts.map