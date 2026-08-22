import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
export declare const inject: string[];
/** 亮/暗配色方案。 */
export type ThemeScheme = 'light' | 'dark';
/** 只读的宿主主题方案源：get() 读当前值，subscribe() 订阅变化并返回退订函数。 */
export interface ThemeSchemeSource {
    get: () => ThemeScheme;
    subscribe: (onChange: (scheme: ThemeScheme) => void) => () => void;
}
/** Injected face: the owning session id plus a draft-prefix writer. */
export interface SkillManagerInjected {
    sessionId: SessionId;
    /** 把文本（如 `/name `）作为前缀插入当前会话输入框草稿，保留已有内容。 */
    prependDraft: (text: string) => void;
    /** 宿主当前亮/暗方案（浅色=白底黑字，深色=黑底白字）。 */
    themeScheme: ThemeSchemeSource;
}
/** Browser plugin body: one self-contained utility entry in the session header. */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map