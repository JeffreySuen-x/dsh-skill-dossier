/** 会话更多菜单拥有管理弹层；用量通过独立子槽位嵌入。 */
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { Panel } from './Panel.tsx'

export const inject = ['slots', 'sessions', 'conversation']

/** Injected face: the owning session id plus a draft-prefix writer. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'skill-manager.usage': { kind: 'single'; scope: 'session' }
  }
}

export interface SkillManagerInjected extends PropsRenderSlots<'skill-manager.usage'> {
  sessionId: SessionId
  /** 把文本（如 `/name `）作为前缀插入当前会话输入框草稿，保留已有内容。 */
  prependDraft: (text: string) => void
}

/** Browser plugin body: one self-contained utility entry in the session header. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'session-log-download',
    priority: -1,
    children: { 'skill-manager.usage': { kind: 'single', scope: 'session' } },
    label: '管理',
    inject: (sessionId: SessionId): Pick<SkillManagerInjected, 'sessionId' | 'prependDraft'> => ({
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
