/** Shared JSON-over-HTTP helpers for the manager and report APIs. */
export declare function readJsonBody(req: any, maxBytes: number): Promise<unknown>;
export declare function respondJson(res: any, status: number, payload: unknown): void;
/** Reject browser requests originating from another site. */
export declare function isCrossSiteRequest(req: any): boolean;
//# sourceMappingURL=http.d.ts.map