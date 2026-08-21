import type { Context } from '@deepseek-ai/cordis';
/** realpath 白名单：candidate 解析符号链接后必须仍落在 dir 的 realpath 内。
 * dir 先解析——dir 不存在（记录里的 root 被篡改）一律返回 false 拒绝；
 * candidate 不存在返回 null（已消失，由调用方决定）；其余失败返回 false。 */
export declare function realpathWithin(candidate: string, dir: string): Promise<boolean | null>;
export declare const name = "skill-manager";
/** Hard dependencies: the row waits for these services at cold boot instead of
 * applying early and silently skipping registrations (insert rows may mount
 * before some bundle rows have activated). */
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map