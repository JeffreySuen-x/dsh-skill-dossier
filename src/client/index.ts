/**
 * Skill 全生命周期管理（browser half）：会话头部右上角的 utilities 区
 * （session-log 同排）挂载「管理」按钮与自包含弹层。数据经
 * `POST /api/skill-manager` 与 host half 通信，不依赖任何客户端专用服务。
 *
 * 「调用」不再走 host followup，而是把 `/name` 手势作为前缀插入当前会话
 * 输入框草稿（prependDraft），由用户补充意图后手动发送——这样技能调用
 * 是「对话的外挂」，而不是替用户发出一个没有意图的裸 `/name`。
 *
 * 配色：全部消费 DSH 原生设计令牌（--dsw-*）。亮/暗由宿主在 <body> 上切
 * `data-ds-dark-theme`，令牌按继承自动生效——本插件不管理主题状态（官方
 * 约定：feature plugin 只读 --dsw-* 与 ctx.theme 快照，不自持主题）。
 */
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { Panel } from './Panel.tsx'

export const inject = ['slots', 'sessions', 'conversation']

/** Injected face: the owning session id plus a draft-prefix writer. */
export interface SkillManagerInjected {
  sessionId: SessionId
  /** 把文本（如 `/name `）作为前缀插入当前会话输入框草稿，保留已有内容。 */
  prependDraft: (text: string) => void
}

/** Browser plugin body: one self-contained utility entry in the session header. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'skill-manager',
    order: 1,
    label: '管理',
    inject: (sessionId: SessionId): SkillManagerInjected => ({
      sessionId,
      prependDraft: (text) => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) return
        const input = ctx.conversation.input.for(actx)
        const draft = input.state.getSnapshot().draft
        input.setDraft(draft === '' ? text : `${text}${draft}`)
      },
    }),
  }, Panel))
}
