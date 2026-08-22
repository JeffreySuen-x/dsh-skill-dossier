/**
 * Skill 全生命周期管理（browser half）：会话头部右上角的 utilities 区
 * （session-log 同排）挂载 Skills 按钮与自包含弹层。数据经
 * `POST /api/skill-manager` 与 host half 通信，不依赖任何客户端专用服务。
 *
 * 「调用」不再走 host followup，而是把 `/name` 手势作为前缀插入当前会话
 * 输入框草稿（prependDraft），由用户补充意图后手动发送——这样技能调用
 * 是「对话的外挂」，而不是替用户发出一个没有意图的裸 `/name`。
 *
 * 配色：不依赖 DSW 主题 token（--dsw-* 与宿主多次出现不一致），改由
 * theme 服务解析当前亮/暗方案，交给 Panel 以 data-theme 显式着色——
 * 浅色=白底黑字，深色=黑底白字，不再做任何自动变色。
 */
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { Panel } from './Panel.tsx'

export const inject = ['slots', 'sessions', 'conversation']

/** 亮/暗配色方案。 */
export type ThemeScheme = 'light' | 'dark'

/** 只读的宿主主题方案源：get() 读当前值，subscribe() 订阅变化并返回退订函数。 */
export interface ThemeSchemeSource {
  get: () => ThemeScheme
  subscribe: (onChange: (scheme: ThemeScheme) => void) => () => void
}

/** Injected face: the owning session id plus a draft-prefix writer. */
export interface SkillManagerInjected {
  sessionId: SessionId
  /** 把文本（如 `/name `）作为前缀插入当前会话输入框草稿，保留已有内容。 */
  prependDraft: (text: string) => void
  /** 宿主当前亮/暗方案（浅色=白底黑字，深色=黑底白字）。 */
  themeScheme: ThemeSchemeSource
}

/** Browser plugin body: one self-contained utility entry in the session header. */
export function apply(ctx: ClientContext): void {
  // theme 服务可能缺失（如纯 host 环境），缺失时按浅色处理。
  const theme = ctx.get('theme')
  let scheme: ThemeScheme = 'light'
  const subscribers = new Set<(scheme: ThemeScheme) => void>()
  if (theme !== undefined) {
    scheme = theme.getTheme().active.colorScheme
  }
  // 'theme/change' 由 @deepseek-ai/dsh-client-ui-theme 声明合并注册到
  // cordis Events；本包未把该包纳入编译（运行时共存即可），因此对
  // ctx.on 收窄为仅含本事件名的签名。无条件监听：theme 服务晚于本插件
  // 挂载时，其构造期的首次 publish 同样会送达。
  const onThemeChange = ctx.on as unknown as
    (name: 'theme/change', listener: (snapshot: { active: { colorScheme: 'light' | 'dark' } }) => void) => () => boolean
  onThemeChange('theme/change', (snapshot) => {
    scheme = snapshot.active.colorScheme
    for (const onChange of subscribers) onChange(scheme)
  })
  const themeScheme: ThemeSchemeSource = {
    get: () => scheme,
    subscribe: (onChange) => {
      subscribers.add(onChange)
      return () => { subscribers.delete(onChange) }
    },
  }

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
        const draft = input.state.getSnapshot().draft
        input.setDraft(draft === '' ? text : `${text}${draft}`)
      },
      themeScheme,
    }),
  }, Panel))
}
