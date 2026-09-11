/**
 * 汇报只做一件事：把 `reporter/brief/` 里的每日简报读出来，按日或按月摊平。
 *
 * 这里刻意没有「复盘 / 导出 / 运行记录」——复盘是 agent 干的事（让 agent 直接读
 * brief），导出是复制粘贴能替代的，运行记录是给一个不存在的调度器准备的。
 * 三者都要额外状态、额外写盘、额外失败面，而日报/月度本身只需要读。
 */
/** 数据目录可配置，默认就是历史行为。 */
export interface ReportConfig {
    /** 数据根目录（相对于工作区）。 */
    dataRoot: string;
    /** 每日简报目录名（dataRoot 之下）。 */
    briefDir: string;
}
export declare const DEFAULT_REPORT_CONFIG: ReportConfig;
/** 归一化插件 config：缺失或非法一律退回默认值。 */
export declare function normalizeReportConfig(raw: unknown): ReportConfig;
export interface ReportProject {
    name: string;
    purpose: string;
    impl: string;
    progress: string[];
    todo: string[];
    issues: string[];
}
export interface ReportFsLike {
    resolve(path: string, opts?: {
        cwd?: string;
    }): Promise<unknown>;
    readText(target: unknown): Promise<string>;
    listDir(target: unknown): Promise<Array<{
        name?: string;
        path?: string;
    }>>;
}
interface ReportAgentLike {
    session: {
        header: {
            cwd: string;
        };
    };
}
export interface ReportAgentsLike {
    get(id: string): ReportAgentLike | undefined;
}
interface ReportRouteLike {
    kind: 'exact';
    path: string;
    handler: (req: any, res: any) => Promise<void>;
}
export interface ReportWebServerLike {
    register(route: ReportRouteLike): () => void;
}
interface EffectContextLike {
    effect(setup: () => () => void): unknown;
}
export interface ReportDependencies {
    webServer: ReportWebServerLike;
    agents: ReportAgentsLike;
    fs: ReportFsLike;
    ensureDirectories(cwd: string, sessionId: string, config: ReportConfig): Promise<void>;
    config?: ReportConfig;
}
/** Parse the brief skill's stable markdown contract. */
export declare function parseBrief(text: string): ReportProject[];
export declare function pickDailyDate(allDates: string[], today: string): {
    date: string;
    fallbackFrom: string;
};
export declare function pickMonth(allDates: string[], currentMonth: string): {
    month: string;
    fallbackMonth: string;
    dates: string[];
};
export declare function toMarkdown(data: any, view: 'daily' | 'monthly'): string;
/** Register `/api/report` as part of the manager package's host activation. */
export declare function registerReportApi(ctx: EffectContextLike, deps: ReportDependencies): void;
export {};
//# sourceMappingURL=report.d.ts.map