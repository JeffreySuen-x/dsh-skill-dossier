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
    writeText(target: unknown, content: string, encoding?: unknown, options?: unknown, policy?: unknown): Promise<unknown>;
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
export interface ReportDependencies {
    webServer: ReportWebServerLike;
    agents: ReportAgentsLike;
    fs: ReportFsLike;
    sandboxPolicy: ReportSandboxPolicyLike;
    ensureDirectories(cwd: string): Promise<void>;
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