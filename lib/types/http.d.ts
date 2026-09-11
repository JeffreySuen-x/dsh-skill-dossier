/** Shared JSON-over-HTTP helpers for the manager and report APIs. */
export declare function readJsonBody(req: any, maxBytes: number): Promise<unknown>;
export declare function respondJson(res: any, status: number, payload: unknown): void;
/** Reject browser requests originating from another site. */
export declare function isCrossSiteRequest(req: any): boolean;
/** 一条 JSON-RPC 路由的处理表：方法名 → 处理函数。 */
export type RpcHandlers = Record<string, (args: any) => unknown>;
/**
 * 两个 API（`/api/skill-manager`、`/api/report`）共用的路由骨架：只接受 POST、
 * 拒跨站、限体积、按 `{ method, args }` 派发、统一包错误。
 *
 * 收成一处不是为了少几行，而是**安全边界只能有一个实现**——同源校验曾经在
 * 两个路由里各写一遍，结果一个 403、一个 200（2026-09-03 修）。
 */
export declare function createRpcRoute(options: {
    handlers: RpcHandlers;
    /** 派发前钩子（如按 sessionId 建目录），抛错即整个请求失败。 */
    before?: (args: any) => Promise<void> | void;
}): (req: any, res: any) => Promise<void>;
//# sourceMappingURL=http.d.ts.map