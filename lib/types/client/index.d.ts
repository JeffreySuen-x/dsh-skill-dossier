import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
export declare const inject: string[];
/** Injected face: the owning session id plus a draft-prefix writer. */
export interface SkillManagerInjected {
    sessionId: SessionId;
    /** 把文本（如 `/name `）作为前缀插入当前会话输入框草稿，保留已有内容。 */
    prependDraft: (text: string) => void;
}
/** Browser plugin body: one self-contained utility entry in the session header. */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map