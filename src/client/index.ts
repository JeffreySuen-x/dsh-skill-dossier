/**
 * Skill 全生命周期管理（browser half）：会话头部右上角的 utilities 区
 * （session-log 同排）挂载 Skills 按钮与自包含弹层。数据经
 * `POST /api/skill-manager` 与 host half 通信，不依赖任何客户端专用服务。
 *
 * 「调用」不再走 host followup，而是把 `/name` 手势作为前缀插入当前会话
 * 输入框草稿（prependDraft），由用户补充意图后手动发送——这样技能调用
 * 是「对话的外挂」，而不是替用户发出一个没有意图的裸 `/name`。
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
    label: 'Skills',
    inject: (sessionId: SessionId): SkillManagerInjected => ({
      sessionId,
      prependDraft: (text) => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) return
        const input = ctx.conversation.input.for(actx)
        const current = input.state.getSnapshot().draft
        input.setDraft(current === '' ? text : `${text}${current}`)
      },
    }),
  }, Panel))
}
