/**
 * Skills 管理面板：目录浏览/搜索/详情/调用/建档，档案页（方向筛选、
 * 未建档清单、档案卡片、停用/重装/删除）。
 * 组件自包含（按钮 + 弹层），无宿主 hook 依赖。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { SkillManagerInjected, ThemeScheme } from './index.ts'
import { DIRECTION_HINTS, DIRECTION_LABELS } from '../directions.ts'
import { reviewCandidates } from '../freshness.ts'
import { dayKey, summarizeUsage } from '../usage.ts'
import type { IndexEntry, TrashRecord } from '../index-store.ts'
import type { UsageRecord } from '../usage.ts'
import css from './Panel.module.css'
import { reportFailureMessage } from './report-state.ts'

const FS_SOURCES = ['project-dsh', 'project-agents', 'user-dsh', 'user-agents', 'custom']
type Origin = 'self' | 'external' | 'system' | 'unknown'
const ORIGIN_LABELS: Record<Origin, string> = { self: '自创', external: '外来', system: '系统', unknown: '未标注' }
const ORIGIN_KEYS: Origin[] = ['self', 'external', 'system', 'unknown']


interface Summary {
  name: string
  description: string
  whenToUse: string | null
  modelInvocable: boolean
  userInvocable: boolean
  source: string
  provider: string
  /** 目录成本估算（name+description+whenToUse 进系统提示的 ≈token 数）。 */
  approxTokens?: number
}
interface Profile extends IndexEntry {}
interface Detail extends Summary {
  content: string
  path: string | null
  profile: Profile | null
}
type IndexData = {
  skills: Record<string, Profile>
  trash: Record<string, TrashRecord>
  usage: Record<string, UsageRecord>
}
interface ListResult {
  skills: Summary[]
  index: IndexData
  /** 全部可见技能的目录成本合计（≈token）。 */
  catalogTokens?: number
  /** 非 null 表示调用统计写盘连续失败，面板据此提示「统计不可用」而不是显示空表。 */
  usageHealth?: string | null
}
interface ReportProject {
  name: string
  purpose?: string
  impl?: string
  progress: string[]
  todo: string[]
  issues: string[]
}
interface ReportDaily {
  date: string
  projects: ReportProject[]
  stats?: { projects: number; progress: number; todo: number; issues: number }
  source?: string
  lastError?: string
  fallbackFrom?: string
}
interface RangeProject {
  name: string
  purpose: string
  progress: string
  todo: string[]
  issues: string[]
  days: string[]
}
/** 周报 / 月报：同一套区间形状，前端只负责画甘特图 + 现状卡。 */
interface ReportRange {
  scope: 'weekly' | 'monthly'
  label: string
  start: string
  end: string
  dates: string[]
  /** 一天一格：count = 那天所有项目的进展条数合计（决定颜色深浅）。 */
  days: Array<{ date: string; count: number; projects: string[] }>
  projects: RangeProject[]
  source?: string
  lastError?: string
  fallbackFrom?: string
}
type ReportData = ReportDaily | ReportRange
type ReportView = 'daily' | 'weekly' | 'monthly'
/** 两个 host 路由共用一个 JSON-RPC 客户端。 */
async function rpc<T = unknown>(path: string, method: string, args?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok || data === null) {
    throw new Error(!res.ok && data !== null && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
  }
  return data as T
}

const MANAGER_API = '/api/skill-manager'
const REPORT_API = '/api/report'

function normalizeList(res: unknown): ListResult {
  const r = (res ?? {}) as { skills?: unknown; index?: unknown; usageHealth?: unknown; catalogTokens?: unknown }
  const idx = (r.index ?? {}) as { skills?: unknown; trash?: unknown; usage?: unknown }
  return {
    skills: Array.isArray(r.skills) ? r.skills as Summary[] : [],
    index: {
      skills: idx.skills !== null && typeof idx.skills === 'object' ? idx.skills as Record<string, Profile> : {},
      trash: idx.trash !== null && typeof idx.trash === 'object' ? idx.trash as Record<string, TrashRecord> : {},
      usage: idx.usage !== null && typeof idx.usage === 'object' ? idx.usage as Record<string, UsageRecord> : {},
    },
    usageHealth: typeof r.usageHealth === 'string' ? r.usageHealth : null,
    catalogTokens: typeof r.catalogTokens === 'number' ? r.catalogTokens : 0,
  }
}

/** 档案卡片上的一行调用统计（并入档案页，替代原「统计」独立板块）。 */
function usageLine(summary: { count: number; activeDays: number; lastUsedAt: number; lastUsedDaysAgo: number } | undefined): string {
  if (summary === undefined) return '调用记录：暂无'
  const when = summary.lastUsedDaysAgo === 0 ? '今天' : `${summary.lastUsedDaysAgo} 天前`
  return `调用记录：${summary.count} 次 · 活跃 ${summary.activeDays} 天 · 最近 ${dayKey(summary.lastUsedAt)}（${when}）`
}

export function Panel({ sessionId, prependDraft, themeScheme }: SkillManagerInjected) {
  const [open, setOpen] = useState(false)
  const [scheme, setScheme] = useState<ThemeScheme>(() => themeScheme.get())
  const [data, setData] = useState<ListResult | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'skills' | 'archive' | 'report'>('skills')
  const [view, setView] = useState<'list' | 'detail' | 'create'>('list')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [filter, setFilter] = useState('all')
  const [confirmName, setConfirmName] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reportView, setReportView] = useState<ReportView>('daily')
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  const reload = () => {
    setData(null)
    rpc<ListResult>(MANAGER_API, 'list', { sessionId })
      .then((res) => setData(normalizeList(res)))
      .catch((error: unknown) => {
        setData({ skills: [], index: { skills: {}, trash: {}, usage: {} } })
        setNotice(String(error))
      })
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setData(null)
    rpc<ListResult>(MANAGER_API, 'list', { sessionId })
      .then((res) => { if (!cancelled) setData(normalizeList(res)) })
      .catch((error: unknown) => {
        if (!cancelled) {
          setData({ skills: [], index: { skills: {}, trash: {}, usage: {} } })
          setNotice(String(error))
        }
      })
    return () => { cancelled = true }
  }, [open, sessionId])

  useEffect(() => themeScheme.subscribe(setScheme), [themeScheme])

  const profiles = data?.index.skills ?? {}
  const trash = data?.index.trash ?? {}
  const usage = data?.index.usage ?? {}
  const usageHealth = data?.usageHealth ?? null
  const catalogTokens = data?.catalogTokens ?? 0
  const skills = data?.skills ?? null
  const tokensByName = new Map((skills ?? []).map((s) => [s.name, s.approxTokens ?? 0]))
  const sourceByName = new Map((skills ?? []).map((s) => [s.name, s.source]))
  const activeNames = skills === null ? null : new Set(skills.map((s) => s.name))
  const hasProfile = (name: string) => Object.prototype.hasOwnProperty.call(profiles, name)
  const isProfiled = (name: string) => {
    const p = profiles[name]
    return p !== undefined && typeof p.direction === 'string' && p.direction !== ''
  }
  const originKeyOfName = (name: string, source: string): Origin | undefined => {
    const entry = profiles[name]
    if (entry !== undefined && entry.origin !== undefined) return entry.origin
    if (source === 'bundled') return 'system'
    return undefined
  }
  const originOf = (s: Summary) => {
    const key = originKeyOfName(s.name, s.source) ?? 'unknown'
    return { key, label: ORIGIN_LABELS[key] }
  }

  const OriginChips = ({ name, value, small }: { name: string; value: string | undefined; small?: boolean }) => (
    <span
      className={`${css.originChips}${small === true ? ` ${css.originSmall}` : ''}`}
      onClick={(e) => e.stopPropagation()}
      title="标注来源：自创 / 外来下载 / 系统内置 / 未标注"
    >
      {ORIGIN_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className={`${css.originChip}${value === key ? ` ${css.originChipActive}` : ''}`}
          disabled={busy}
          onClick={() => doCall('setOrigin', { name, origin: key, sessionId })}
        >
          {ORIGIN_LABELS[key]}
        </button>
      ))}
    </span>
  )

  const doCall = (method: string, arg: unknown, onOk?: () => void) => {
    setBusy(true)
    setNotice('')
    rpc<{ ok: boolean; error?: string }>(MANAGER_API, method, arg)
      .then((res) => {
        setBusy(false)
        if (res !== null && typeof res === 'object' && res.ok === true) {
          onOk?.()
          reload()
        } else {
          setNotice(res !== null && typeof res === 'object' && typeof res.error === 'string' ? res.error : '操作失败')
        }
      })
      .catch((error: unknown) => { setBusy(false); setNotice(String(error)) })
  }

  const invoke = (name: string) => {
    prependDraft(`/${name} `)
    setOpen(false)
  }
  const ingest = (name: string) => doCall('ingest', { name, sessionId }, () => setOpen(false))
  const uninstall = (name: string) => doCall('uninstall', { name, sessionId })
  const deleteSkill = (name: string) => { setConfirmName(null); doCall('deleteSkill', { name, sessionId }) }

  /** 破坏性动作 + 二次确认。confirmName 是单值，所以同一时刻只有一个动作在确认态。 */
  const DangerDelete = ({ name, source }: { name: string; source: string }) => (
    confirmName === name
      ? (
        <>
          <Btn label="确认删除" kind="danger" onClick={(e) => { e.stopPropagation(); deleteSkill(name) }} />
          <Btn label="取消" onClick={(e) => { e.stopPropagation(); setConfirmName(null) }} />
        </>
      )
      : (
        <Btn
          label="删除"
          kind="danger"
          title={`把 ${name} 移入 trash 后彻底删除，不可恢复（来源：${source}）`}
          onClick={(e) => { e.stopPropagation(); setConfirmName(name) }}
        />
      )
  )
  const reinstall = (name: string) => doCall('reinstall', { name, sessionId })
  const deleteTrash = (name: string) => { setConfirmName(null); doCall('deleteTrash', { name, sessionId }) }

  const openDetail = (name: string) => {
    setView('detail')
    setDetail(null)
    setNotice('')
    rpc<Detail | null>(MANAGER_API, 'get', { name, sessionId })
      .then((res) => setDetail(res))
      .catch((error: unknown) => { setDetail(null); setNotice(String(error)) })
  }

  const onKeyDown = (e: ReactKeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }

  const Btn = ({ label, onClick, kind, title, disabled }: {
    label: string
    onClick: (e: ReactMouseEvent) => void
    kind?: 'primary' | 'danger'
    title?: string
    disabled?: boolean
  }) => (
    <button
      type="button"
      className={`${css.btn}${kind === 'primary' ? ` ${css.btnPrimary}` : ''}${kind === 'danger' ? ` ${css.btnDanger}` : ''}`}
      disabled={busy || disabled === true}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  )

  // ---------- 技能目录 ----------

  const row = (s: Summary) => {
    const profiled = isProfiled(s.name)
    const fsSkill = FS_SOURCES.includes(s.source)
    const origin = originOf(s)
    return (
      <div key={s.name} className={css.row} onClick={() => openDetail(s.name)}>
        <div className={css.rowMain}>
          <div className={css.rowName}>
            {s.name}
            <span className={`${css.badge}${origin.key === 'self' || origin.key === 'system' ? ` ${css.badgeOk}` : ''}`}>{origin.label}</span>
            {profiled
              ? <span className={`${css.badge} ${css.badgeOk}`}>{profiles[s.name]?.direction}</span>
              : <span className={css.badge}>未建档</span>}
            {s.userInvocable ? null : <span className={css.badge}>禁用户调用</span>}
          </div>
          <div className={css.rowDesc}>{s.description}</div>
        </div>
        <Btn label="调用" kind="primary" disabled={!s.userInvocable} title={s.userInvocable ? `把 /${s.name} 填入输入框，再补充你的需求` : '该技能不允许用户显式调用'} onClick={(e) => { e.stopPropagation(); invoke(s.name) }} />
        {profiled || !fsSkill ? null : <Btn label="建档" onClick={(e) => { e.stopPropagation(); ingest(s.name) }} />}
        {fsSkill
          ? (
            <>
              <Btn label="停用" title="移入 trash，可重装" onClick={(e) => { e.stopPropagation(); uninstall(s.name) }} />
              <DangerDelete name={s.name} source={s.source} />
            </>
          )
          : null}
      </div>
    )
  }

  const listBody = () => {
    const q = query.trim().toLowerCase()
    const filtered = skills === null ? null : skills.filter((s) => {
      if (q === '') return true
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    })
    return (
      <>
        <input
          className={css.search}
          type="text"
          placeholder="搜索名称或描述…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        {skills === null
          ? <div className={css.hint}>加载中…</div>
          : filtered !== null && filtered.length === 0
            ? <div className={css.hint}>{skills.length === 0 ? '当前没有可用技能' : '没有匹配的技能'}</div>
            : <div className={css.list}>{(filtered ?? []).map(row)}</div>}
      </>
    )
  }

  // ---------- 详情 ----------

  const detailBody = () => {
    if (detail === null) return <div className={css.hint}>加载中…</div>
    const d = detail
    const p = d.profile
    return (
      <>
        <div className={css.detailMeta}>
          <div className={css.rowName}>
            {d.name}
            {p !== null && p.direction !== undefined && p.direction !== ''
              ? <span className={`${css.badge} ${css.badgeOk}`}>{p.direction}</span>
              : null}
            {d.modelInvocable ? null : <span className={css.badge}>仅用户调用</span>}
          </div>
          <OriginChips name={d.name} value={originKeyOfName(d.name, d.source)} />
          <div className={css.detailDesc}>{d.description}</div>
          {d.whenToUse !== null ? <div className={css.detailWhen}>适用：{d.whenToUse}</div> : null}
          <div className={css.detailSrc}>
            来源：{d.source} · provider: {d.provider}{d.path !== null ? ` · ${d.path}` : ''}
          </div>
          {p !== null && p.direction !== undefined && p.direction !== '' ? (
            <div className={css.profile}>
              <div className={css.profileRow}>使用范围：{p.useScope}</div>
              <div className={css.profileRow}>能力边界：{p.boundaries}</div>
              <div className={css.profileRow}>应用场景：{p.scenarios}</div>
            </div>
          ) : null}
        </div>
        <div className={css.detailActions}>
          <Btn label="← 返回" onClick={() => { setView('list'); setDetail(null) }} />
          {d.userInvocable ? <Btn label="调用" kind="primary" onClick={() => invoke(d.name)} /> : null}
          <Btn label={p !== null ? '重新建档' : '建档'} onClick={() => ingest(d.name)} />
          {FS_SOURCES.includes(d.source) ? <Btn label="停用" onClick={() => uninstall(d.name)} /> : null}
        </div>
        <pre className={css.pre}>{d.content}</pre>
      </>
    )
  }

  // ---------- 档案 ----------

  const archiveBody = () => {
    const profiledNames = Object.keys(profiles)
    const unprofiled = skills === null ? [] : skills.filter((s) => !hasProfile(s.name))
    const trashedNames = Object.keys(trash)
    const usageByName = new Map(summarizeUsage(usage, Date.now()).map((entry) => [entry.name, entry]))
    const needsReview = reviewCandidates(profiles, usage, Date.now(), 5)
    const directionSet = new Set<string>(DIRECTION_LABELS)
    for (const n of profiledNames) {
      const d = profiles[n]?.direction
      if (typeof d === 'string' && d !== '') directionSet.add(d)
    }
    const directionOptions = Array.from(directionSet)

    const chip = (label: string, value: string, count?: number, title?: string) => (
      <button
        key={value}
        type="button"
        className={`${css.chip}${filter === value ? ` ${css.chipActive}` : ''}`}
        title={title}
        onClick={() => setFilter(value)}
      >
        {label}{count !== undefined ? ` ${count}` : ''}
      </button>
    )

    const profileCard = (name: string) => {
      const p = profiles[name]
      if (p === undefined) return null
      const active = activeNames !== null && activeNames.has(name)
      const trashed = Object.prototype.hasOwnProperty.call(trash, name)
      const origin = p.origin ?? 'unknown'
      const profiled = p.direction !== undefined && p.direction !== ''
      const visible = filter === 'all'
        || (filter === 'active' && active)
        || (filter === 'trashed' && trashed)
        || (filter === p.direction)
        || (filter === origin)
      if (!visible) return null
      return (
        <div key={name} className={css.card}>
          <div className={css.cardHead}>
            <span className={css.rowName}>{name}</span>
            <span className={`${css.badge}${origin === 'self' || origin === 'system' ? ` ${css.badgeOk}` : ''}`}>{ORIGIN_LABELS[origin]}</span>
            {profiled
              ? <span className={`${css.badge} ${css.badgeOk}`} title={DIRECTION_HINTS[p.direction ?? '']}>{p.direction}</span>
              : <span className={css.badge}>未建档</span>}
            {trashed
              ? <span className={css.badge}>已停用</span>
              : active
                ? <span className={`${css.badge} ${css.badgeOk}`}>启用中</span>
                : <span className={css.badge}>不在目录</span>}
          </div>
          {profiled ? (
            <>
              <div className={css.profileRow}>使用范围：{p.useScope}</div>
              <div className={css.profileRow}>能力边界：{p.boundaries}</div>
              <div className={css.profileRow}>应用场景：{p.scenarios}</div>
              {p.notes !== undefined && p.notes !== '' ? <div className={css.profileRow}>备注：{p.notes}</div> : null}
            </>
          ) : null}
          <div className={css.profileRow}>{usageLine(usageByName.get(name))}</div>
          {tokensByName.has(name) ? (
            <div className={css.profileRow}>目录成本：≈{tokensByName.get(name)} tokens（名称+描述常驻系统提示）</div>
          ) : null}
          {p.outcomes !== undefined ? (
            <div className={css.profileRow}>
              实测：加载成功 {p.outcomes.loaded} 次
              {p.outcomes.failed > 0 ? ` · 失败 ${p.outcomes.failed} 次${p.outcomes.lastError !== undefined && p.outcomes.lastError !== '' ? `（${p.outcomes.lastError}）` : ''}` : ''}
            </div>
          ) : null}
          <OriginChips name={name} value={p.origin} small />
          <div className={css.detailActions}>
            <Btn label={profiled ? '重新建档' : '识别建档'} {...(profiled ? {} : { kind: 'primary' as const })} onClick={() => ingest(name)} />
            {trashed
              ? (
                <>
                  <Btn label="重装" kind="primary" onClick={() => reinstall(name)} />
                  {confirmName === name
                    ? (
                      <>
                        <Btn label="确认删除" kind="danger" onClick={() => deleteTrash(name)} />
                        <Btn label="取消" onClick={() => setConfirmName(null)} />
                      </>
                    )
                    : <Btn label="删除" kind="danger" onClick={() => setConfirmName(name)} />}
                </>
              )
              : active
                ? (
                  <>
                    <Btn label="停用" title="移入 trash，可重装" onClick={() => uninstall(name)} />
                    <DangerDelete name={name} source={sourceByName.get(name) ?? '文件系统'} />
                  </>
                )
                : null}
          </div>
        </div>
      )
    }

    return (
      <>
        <div className={css.chips}>
          {chip('全部', 'all')}
          {chip('未建档', 'unprofiled', unprofiled.length)}
          {chip('启用中', 'active')}
          {chip('已停用', 'trashed', trashedNames.length)}
          {directionOptions.map((d) => chip(d, d, undefined, DIRECTION_HINTS[d]))}
          {ORIGIN_KEYS.map((k) => chip(ORIGIN_LABELS[k], k))}
        </div>
        <div className={css.hint}>
          目录成本合计 ≈{catalogTokens} tokens：{profiledNames.length} 条档案对应的技能目录会整段进系统提示，越靠前的技能越占预算。
        </div>
        {needsReview.length > 0 ? (
          <div className={css.section}>
            <div className={css.sectionTitle}>待复审（{needsReview.length}）</div>
            <div className={css.hint}>
              按「易变方向 + 长期未用 + 久未复审」排序，点进去看档案再决定更新还是删。
            </div>
            {needsReview.map((entry) => (
              <div key={entry.name} className={css.row}>
                <div className={css.rowMain}>
                  <div className={css.rowName}>
                    {entry.name}
                    <span className={css.badge}>{entry.direction}</span>
                  </div>
                  <div className={css.rowDesc}>{entry.reasons.join('、')}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {(filter === 'all' || filter === 'unprofiled') && unprofiled.length > 0 ? (
          <div className={css.section}>
            <div className={css.sectionTitle}>新加入/未建档（{unprofiled.length}）</div>
            {unprofiled.map((s) => (
              <div key={s.name} className={css.row}>
                <div className={css.rowMain}>
                  <div className={css.rowName}>{s.name}</div>
                  <div className={css.rowDesc}>{s.description}</div>
                </div>
                <Btn label="识别建档" kind="primary" onClick={() => ingest(s.name)} />
              </div>
            ))}
          </div>
        ) : null}
        <div className={css.section}>
          <div className={css.sectionTitle}>技能档案（{profiledNames.length}）</div>
          {profiledNames.length === 0
            ? <div className={css.hint}>还没有档案。在「技能」页点击「建档」，或直接让 AI 用 skill_archive 工具建档。</div>
            : profiledNames.map(profileCard)}
        </div>
        {trashedNames.length > 0
          ? <div className={css.hint}>已停用技能保存在 trash 目录，可重装或彻底删除。</div>
          : null}
      </>
    )
  }

  // ---------- 汇报（调用本包内聚的 report host /api/report） ----------

  const reportRpc = <T,>(method: string, args?: unknown): Promise<T> => rpc<T>(REPORT_API, method, args)

  const loadReport = (view: ReportView = reportView) => {
    setReportLoading(true)
    setReportError('')
    setReportData(null)
    const method = view === 'daily' ? 'generateDaily' : view === 'weekly' ? 'generateWeekly' : 'generateMonthly'
    reportRpc<ReportData>(method, { sessionId })
      .then((data) => {
        // 个别简报读不出来时保留其余数据 + 顶部告警，不要把整页清空。
        setReportError(reportFailureMessage(data))
        setReportData(data)
        setReportLoading(false)
      })
      .catch((error: unknown) => { setReportError(String(error)); setReportLoading(false) })
  }

  const joinItems = (items: string[] | undefined): string => {
    const list = items ?? []
    if (list.length === 0) return '无'
    return list.length <= 3 ? list.join('；') : `${list.slice(0, 3).join('；')}（+${list.length - 3}）`
  }

  const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

  /**
   * 颜色四级 = 那天做了多少（一格一天，越深越多）。
   * 阈值按本工作区实测标定：14 天里 4~150 条、中位 36 条；用相对分位会让
   * 「20 条这周深、下周浅」，颜色就读不出绝对量了，所以用固定档。
   * ponytail: 固定档在产量量级变化后会饱和；届时改成按区间分位数的自适应档。
   */
  const HEAT_STEPS = [9, 29, 59] as const
  const heatClass = (count: number): string => {
    if (count <= 0) return ''
    if (count <= HEAT_STEPS[0]) return ` ${css.heatL1}`
    if (count <= HEAT_STEPS[1]) return ` ${css.heatL2}`
    if (count <= HEAT_STEPS[2]) return ` ${css.heatL3}`
    return ` ${css.heatL4}`
  }

  const heatTitle = (date: string, day: { count: number; projects: string[] } | undefined): string => {
    if (day === undefined || day.count === 0) return `${date} · 无记录`
    const who = day.projects.length > 0 ? `：${day.projects.join('、')}` : ''
    return `${date} · ${day.count} 条进展${who}`
  }

  /** 周报：一行 7 格，一格一天。 */
  const reportWeekStrip = (range: ReportRange) => {
    const byDate = new Map(range.days.map((day) => [day.date, day]))
    return (
      <div className={css.weekStrip}>
        {range.dates.map((date) => {
          const weekday = (new Date(`${date}T00:00:00`).getDay() + 6) % 7
          return (
            <div key={date} className={css.weekDay}>
              <span className={`${css.heatCell}${heatClass(byDate.get(date)?.count ?? 0)}`} title={heatTitle(date, byDate.get(date))} />
              <span className={css.weekDayLabel}>{WEEKDAY_LABELS[weekday]}</span>
              <span className={css.weekDayNum}>{Number(date.slice(8))}</span>
            </div>
          )
        })}
      </div>
    )
  }

  /** 月报：GitHub 式日历，列＝周、行＝周一~周日，一格一天。 */
  const reportMonthCalendar = (range: ReportRange) => {
    const byDate = new Map(range.days.map((day) => [day.date, day]))
    const weeks: Array<Array<string | null>> = []
    let column: Array<string | null> = []
    range.dates.forEach((date, index) => {
      const weekday = (new Date(`${date}T00:00:00`).getDay() + 6) % 7
      if (index === 0 && weekday > 0) column = Array.from({ length: weekday }, () => null)
      column.push(date)
      if (column.length === 7) {
        weeks.push(column)
        column = []
      }
    })
    if (column.length > 0) {
      while (column.length < 7) column.push(null)
      weeks.push(column)
    }
    return (
      <div className={css.heatGrid}>
        <div className={css.heatWeekdays}>
          {WEEKDAY_LABELS.map((label, index) => (
            <span key={label}>{index % 2 === 0 ? label : ''}</span>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className={css.heatWeek}>
            {week.map((date, dayIndex) => (
              date === null
                ? <span key={`empty-${dayIndex}`} className={css.heatBlank} />
                : <span key={date} className={`${css.heatCell}${heatClass(byDate.get(date)?.count ?? 0)}`} title={heatTitle(date, byDate.get(date))} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  const reportHeatLegend = () => (
    <div className={css.heatLegend}>
      <span>少</span>
      <span className={css.heatCell} title="0 条" />
      <span className={`${css.heatCell} ${css.heatL1}`} title={`1~${HEAT_STEPS[0]} 条`} />
      <span className={`${css.heatCell} ${css.heatL2}`} title={`${HEAT_STEPS[0] + 1}~${HEAT_STEPS[1]} 条`} />
      <span className={`${css.heatCell} ${css.heatL3}`} title={`${HEAT_STEPS[1] + 1}~${HEAT_STEPS[2]} 条`} />
      <span className={`${css.heatCell} ${css.heatL4}`} title={`${HEAT_STEPS[2] + 1} 条以上`} />
      <span>多</span>
    </div>
  )

  /** 周报/月报的项目卡：作用 / 进度 / 待办 / 难点，一行一项，不展开。 */
  const reportRangeProjects = (projects: RangeProject[]) => {
    if (projects.length === 0) {
      return <div className={css.hint}>该区间暂无记录。按 brief skill 维护 reporter/brief/YYYY-MM-DD.md，这里会自动汇总。</div>
    }
    return (
      <div className={css.reportSec}>
        {projects.map((project) => (
          <div key={project.name} className={css.reportProject}>
            <strong>{project.name}</strong>
            <div>作用：{project.purpose || '—'}</div>
            <div>进度：{project.progress || '—'}</div>
            <div>待办：{joinItems(project.todo)}</div>
            <div>难点：{joinItems(project.issues)}</div>
          </div>
        ))}
      </div>
    )
  }

  const reportItems = (items: string[] | undefined, empty: string) => {
    const list = items ?? []
    if (list.length === 0) return <li className={css.muted}>{empty}</li>
    return list.map((item, index) => <li key={index}>{item}</li>)
  }

  const reportProjects = (projects: ReportProject[] | undefined) => {
    const list = projects ?? []
    if (list.length === 0) {
      return <div className={css.hint}>暂无记录。按 brief skill 维护 reporter/brief/YYYY-MM-DD.md，这里会自动汇总。</div>
    }
    return (
      <div className={css.reportSec}>
        <div className={css.sectionTitle}>进行项目（{list.length}）</div>
        {list.map((project, index) => (
          <div key={`${project.name}-${index}`} className={css.reportProject}>
            <strong>{index + 1}、{project.name}</strong>
            {project.purpose ? <div>作用：{project.purpose}</div> : null}
            {project.impl ? <div>实现：{project.impl}</div> : null}
            <div>今日进度：</div>
            <ul>{reportItems(project.progress, '（暂无）')}</ul>
            <div>待办：</div>
            <ul>{reportItems(project.todo, '（无）')}</ul>
            <div>问题：</div>
            <ul>{reportItems(project.issues, '（无）')}</ul>
          </div>
        ))}
      </div>
    )
  }

  const reportBody = () => {
    const data = reportData
    let content: ReactNode = null
    if (reportLoading) content = <div className={css.hint}>读取 brief…</div>
    else if (data !== null) {
      if (reportView !== 'daily' && 'dates' in data) {
        const range = data as ReportRange
        const title = reportView === 'weekly' ? '周报' : '月报'
        const active = range.projects.length
        content = (
          <>
            <div className={css.reportSec}>
              <div className={css.sectionTitle}>
                {title} {range.label}
                {range.fallbackFrom ? ` · 回退自 ${range.fallbackFrom}` : ''}
              </div>
              <div className={css.hint}>
                {range.days.length === 0
                  ? '该区间暂无记录。'
                  : `${range.days.length} 天有记录 · ${active} 个项目 · 一格一天，越深＝当天做得越多`}
              </div>
              {range.days.length > 0
                ? (reportView === 'weekly' ? reportWeekStrip(range) : reportMonthCalendar(range))
                : null}
              {reportHeatLegend()}
            </div>
            {reportRangeProjects(range.projects)}
          </>
        )
      } else {
        const daily = data as ReportDaily
        content = (
          <>
            <div className={css.reportSec}>
              <div className={css.sectionTitle}>
                每日简报（{daily.date}）{daily.fallbackFrom ? ` · 回退自 ${daily.fallbackFrom}` : ''}
              </div>
              {daily.stats ? <div className={css.hint}>共 {daily.stats.projects} 个项目 · {daily.stats.progress} 条进度 · {daily.stats.todo} 条待办 · {daily.stats.issues} 条问题</div> : null}
            </div>
            {reportProjects(daily.projects)}
          </>
        )
      }
    }
    return (
      <div className={css.reportBody}>
        <div className={css.reportActions}>
          <button type="button" className={`${css.reportViewBtn}${reportView === 'daily' ? ` ${css.reportViewBtnActive}` : ''}`} onClick={() => { setReportView('daily'); loadReport('daily') }}>日报</button>
          <button type="button" className={`${css.reportViewBtn}${reportView === 'weekly' ? ` ${css.reportViewBtnActive}` : ''}`} onClick={() => { setReportView('weekly'); loadReport('weekly') }}>周报</button>
          <button type="button" className={`${css.reportViewBtn}${reportView === 'monthly' ? ` ${css.reportViewBtnActive}` : ''}`} onClick={() => { setReportView('monthly'); loadReport('monthly') }}>月报</button>
        </div>
        {reportError !== '' ? <div className={css.notice}>{reportError}</div> : null}
        {content}
      </div>
    )
  }

  // ---------- 骨架 ----------

  const headerTitle = tab === 'archive' ? '技能档案' : tab === 'report' ? '汇报' : view === 'detail' ? '技能详情' : '技能'

  return (
    <div className={css.wrap} data-theme={scheme}>
      <button
        type="button"
        className={`${css.toggle}${open ? ` ${css.toggleActive}` : ''}`}
        title="技能目录 / 档案 / 汇报"
        onClick={() => setOpen(!open)}
      >
        管理
      </button>
      {open ? (
        <div className={css.panel} onKeyDown={onKeyDown}>
          <div className={css.header}>
            <span className={css.title}>{headerTitle}</span>
            <button type="button" className={css.btn} aria-label="关闭" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className={css.tabs}>
            <button type="button" className={`${css.tab}${tab === 'skills' ? ` ${css.tabActive}` : ''}`} onClick={() => { setTab('skills'); setView('list'); setDetail(null); setNotice('') }}>技能</button>
            <button type="button" className={`${css.tab}${tab === 'archive' ? ` ${css.tabActive}` : ''}`} onClick={() => { setTab('archive'); setNotice('') }}>档案</button>
            <button type="button" className={`${css.tab}${tab === 'report' ? ` ${css.tabActive}` : ''}`} onClick={() => { setTab('report'); setNotice(''); if (reportData === null && !reportLoading) loadReport() }}>汇报</button>
          </div>
          {notice !== '' ? <div className={css.notice}>{notice}</div> : null}
          {usageHealth !== null
            ? <div className={css.notice}>调用统计写盘失败（技能本身不受影响）：{usageHealth}</div>
            : null}
          {tab === 'archive'
            ? archiveBody()
            : tab === 'report'
              ? reportBody()
              : view === 'list' ? listBody() : detailBody()}
        </div>
      ) : null}
    </div>
  )
}
