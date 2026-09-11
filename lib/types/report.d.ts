import { type ReportConfig, type ReviewReport } from './report-runs.ts';
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
        target?: unknown;
    }>>;
    writeText(target: unknown, content: string, expected?: unknown, signal?: unknown, policy?: unknown): Promise<unknown>;
}
interface ReportAgentLike {
    session: {
        header: {
            cwd: string;
        };
    };
    followup(message: unknown): void;
}
export interface ReportAgentsLike {
    get(id: string): ReportAgentLike | undefined;
}
export interface ReportSandboxPolicyLike {
    resolve(request?: {
        session?: unknown;
    }): unknown;
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
/** 一次复盘的运行记录（内存态；产物落盘才是完成判据）。 */
export interface ReviewRun {
    id: string;
    date: string;
    status: 'running' | 'done' | 'failed' | 'cancelled';
    startedAt: number;
    endedAt?: number;
    skill: string;
    dispatch: 'session' | 'subagent';
    markdownPath: string;
    jsonPath: string;
    /** 完成时产物里带了哪一份。 */
    artifact?: 'json' | 'markdown';
    report?: ReviewReport;
    /** 结构化产物不合约时的原因（不致命：回退 markdown）。 */
    structuredError?: string;
    error?: string;
    /** 入队时两份产物的内容快照——「内容变了」才算完成，仅内部使用。 */
    baseline?: {
        json?: string | undefined;
        markdown?: string | undefined;
    };
}
export interface ReportDependencies {
    webServer: ReportWebServerLike;
    agents: ReportAgentsLike;
    fs: ReportFsLike;
    sandboxPolicy: ReportSandboxPolicyLike;
    ensureDirectories(cwd: string, sessionId: string, config: ReportConfig): Promise<void>;
    config?: ReportConfig;
    /** cordis timer 服务；缺失则定时复盘不可用（不影响手动复盘）。 */
    interval?: (callback: () => void, delayMs: number) => () => void;
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