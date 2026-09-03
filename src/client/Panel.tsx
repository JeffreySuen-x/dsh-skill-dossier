/**
 * Skills 管理面板：目录浏览/搜索/详情/调用/建档，档案页（方向筛选、
 * 未建档清单、档案卡片、停用/重装/删除），以及会话级临时技能的注册与卸载。
 * 组件自包含（按钮 + 弹层），无宿主 hook 依赖。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { SkillManagerInjected, ThemeScheme } from './index.ts'
import { DIRECTION_LABELS } from '../directions.ts'
import css from './Panel.module.css'

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
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
  owned: boolean
}
interface Profile {
  name: string
  direction?: string
  useScope?: string
  boundaries?: string
  scenarios?: string
  notes?: string
  origin?: Origin
  updatedAt: number
}
interface TrashRecord {
  name: string
  originalPath: string
  trashedPath: string
  root: string
  removedAt: number
}
interface UsageRecord {
  count: number
  firstUsedAt: number
  lastUsedAt: number
  daily: Record<string, number>
  recent: number[]
}
interface IndexData {
  skills: Record<string, Profile>
  trash: Record<string, TrashRecord>
  usage: Record<string, UsageRecord>
}
interface Detail extends Summary {
  content: string
  path: string | null
  profile: Profile | null
}
interface ListResult {
  skills: Summary[]
  index: IndexData
}
interface MatchItem {
  name: string
  direction: string
  useScope: string
  scenarios: string
  score: number
  matched: string[]
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
interface ReportDay {
  date: string
  projects: string[]
  progress: string[]
  todo: string[]
  issues: string[]
}
interface ReportMonthly {
  month: string
  days: ReportDay[]
  projects: ReportProject[]
  source?: string
  lastError?: string
  fallbackMonth?: string
}
type ReportData = ReportDaily | ReportMonthly
type ReportView = 'daily' | 'monthly'

async function rpc<T = unknown>(method: string, args?: unknown): Promise<T> {
  const res = await fetch('/api/skill-manager', {
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

function normalizeList(res: unknown): ListResult {
  const r = (res ?? {}) as { skills?: unknown; index?: unknown }
  const idx = (r.index ?? {}) as { skills?: unknown; trash?: unknown; usage?: unknown }
  return {
    skills: Array.isArray(r.skills) ? r.skills as Summary[] : [],
    index: {
      skills: idx.skills !== null && typeof idx.skills === 'object' ? idx.skills as Record<string, Profile> : {},
      trash: idx.trash !== null && typeof idx.trash === 'object' ? idx.trash as Record<string, TrashRecord> : {},
      usage: idx.usage !== null && typeof idx.usage === 'object' ? idx.usage as Record<string, UsageRecord> : {},
    },
  }
}

export function Panel({ sessionId, prependDraft, themeScheme }: SkillManagerInjected) {
  const [open, setOpen] = useState(false)
  const [scheme, setScheme] = useState<ThemeScheme>(() => themeScheme.get())
  const [data, setData] = useState<ListResult | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'skills' | 'archive' | 'match' | 'usage' | 'report'>('skills')
  const [view, setView] = useState<'list' | 'detail' | 'create'>('list')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [filter, setFilter] = useState('all')
  const [confirmName, setConfirmName] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', whenToUse: '', content: '', modelInvocable: true, userInvocable: true })
  const [matchQuery, setMatchQuery] = useState('')
  const [matches, setMatches] = useState<MatchItem[] | null>(null)
  const [matchTotal, setMatchTotal] = useState(0)
  const [matchBusy, setMatchBusy] = useState(false)
  const [matchError, setMatchError] = useState('')
  const [reportView, setReportView] = useState<ReportView>('daily')
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportNotice, setReportNotice] = useState('')

  const reload = () => {
    setData(null)
    rpc<ListResult>('list', { sessionId })
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
    rpc<ListResult>('list', { sessionId })
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
  const skills = data?.skills ?? null
  const activeNames = skills === null ? null : new Set(skills.map((s) => s.name))
  const hasProfile = (name: string) => Object.prototype.hasOwnProperty.call(profiles, name)
  const isProfiled = (name: string) => {
    const p = profiles[name]
    return p !== undefined && typeof p.direction === 'string' && p.direction !== ''
  }
  const originKeyOfName = (name: string, owned: boolean, source: string): Origin | undefined => {
    const entry = profiles[name]
    if (entry !== undefined && entry.origin !== undefined) return entry.origin
    if (owned) return 'self'
    if (source === 'bundled') return 'system'
    return undefined
  }
  const originOf = (s: Summary) => {
    const key = originKeyOfName(s.name, s.owned, s.source) ?? 'unknown'
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
    rpc<{ ok: boolean; error?: string }>(method, arg)
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
  const runMatch = () => {
    const q = matchQuery.trim()
    if (q === '') { setMatchError('请输入任务描述，例如「帮我写一个登录页面」'); return }
    setMatchBusy(true)
    setMatchError('')
    rpc<{ ok: boolean; error?: string; matches?: MatchItem[]; total?: number }>('match', { query: q, sessionId })
      .then((res) => {
        setMatchBusy(false)
        if (res !== null && typeof res === 'object' && res.ok === true) {
          setMatches(res.matches ?? [])
          setMatchTotal(res.total ?? 0)
        } else {
          setMatches([])
          setMatchError(res !== null && typeof res === 'object' && typeof res.error === 'string' ? res.error : '匹配失败')
        }
      })
      .catch((error: unknown) => { setMatchBusy(false); setMatches([]); setMatchError(String(error)) })
  }
  const ingest = (name: string) => doCall('ingest', { name, sessionId }, () => setOpen(false))
  const uninstall = (name: string) => doCall('uninstall', { name, sessionId })
  const reinstall = (name: string) => doCall('reinstall', { name, sessionId })
  const deleteTrash = (name: string) => { setConfirmName(null); doCall('deleteTrash', { name, sessionId }) }
  const removeSkill = (name: string) => doCall('unregister', { name, sessionId })

  const openDetail = (name: string) => {
    setView('detail')
    setDetail(null)
    setNotice('')
    rpc<Detail | null>('get', { name, sessionId })
      .then((res) => setDetail(res))
      .catch((error: unknown) => { setDetail(null); setNotice(String(error)) })
  }

  const submitCreate = () => {
    const name = form.name.trim()
    if (!NAME_RE.test(name)) { setNotice('名称必须是 kebab-case（小写字母、数字、连字符）'); return }
    if (form.description.trim() === '') { setNotice('描述不能为空'); return }
    if (form.content.trim() === '') { setNotice('内容不能为空'); return }
    setBusy(true)
    setNotice('')
    rpc<{ ok: boolean; error?: string }>('register', {
      sessionId, name, description: form.description.trim(), whenToUse: form.whenToUse.trim(),
      content: form.content, modelInvocable: form.modelInvocable, userInvocable: form.userInvocable,
    }).then((res) => {
      setBusy(false)
      if (res !== null && typeof res === 'object' && res.ok === true) {
        setView('list')
        setForm({ name: '', description: '', whenToUse: '', content: '', modelInvocable: true, userInvocable: true })
        reload()
      } else {
        setNotice(res !== null && typeof res === 'object' && typeof res.error === 'string' ? res.error : '注册失败')
      }
    }).catch((error: unknown) => { setBusy(false); setNotice(String(error)) })
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
        {s.owned
          ? <Btn label="卸载" kind="danger" onClick={(e) => { e.stopPropagation(); removeSkill(s.name) }} />
          : fsSkill ? <Btn label="停用" onClick={(e) => { e.stopPropagation(); uninstall(s.name) }} /> : null}
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
            {d.owned ? <span className={css.badge}>临时</span> : null}
            {p !== null && p.direction !== undefined && p.direction !== ''
              ? <span className={`${css.badge} ${css.badgeOk}`}>{p.direction}</span>
              : null}
            {d.modelInvocable ? null : <span className={css.badge}>仅用户调用</span>}
          </div>
          <OriginChips name={d.name} value={originKeyOfName(d.name, d.owned, d.source)} />
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
          {d.owned
            ? <Btn label="卸载" kind="danger" onClick={() => removeSkill(d.name)} />
            : FS_SOURCES.includes(d.source) ? <Btn label="停用" onClick={() => uninstall(d.name)} /> : null}
        </div>
        <pre className={css.pre}>{d.content}</pre>
      </>
    )
  }

  // ---------- 新建临时技能 ----------

  const createBody = () => (
    <div className={css.form}>
      <input className={css.input} type="text" placeholder="名称（kebab-case，如 my-skill）" value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input className={css.input} type="text" placeholder="描述（给模型的触发说明）" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <input className={css.input} type="text" placeholder="whenToUse（可选）" value={form.whenToUse} onChange={(e) => setForm({ ...form, whenToUse: e.target.value })} />
      <label className={css.formRow}>
        <input type="checkbox" checked={form.modelInvocable} onChange={(e) => setForm({ ...form, modelInvocable: e.target.checked })} />
        模型可调用
      </label>
      <label className={css.formRow}>
        <input type="checkbox" checked={form.userInvocable} onChange={(e) => setForm({ ...form, userInvocable: e.target.checked })} />
        用户可调用（/name 手势）
      </label>
      <textarea className={css.textarea} rows={10} placeholder="技能正文（markdown）" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      <div className={css.detailActions}>
        <Btn label={busy ? '保存中…' : '注册'} kind="primary" onClick={submitCreate} />
        <Btn label="取消" onClick={() => { setNotice(''); setView('list') }} />
      </div>
    </div>
  )

  // ---------- 档案 ----------

  const archiveBody = () => {
    const profiledNames = Object.keys(profiles)
    const unprofiled = skills === null ? [] : skills.filter((s) => !hasProfile(s.name))
    const trashedNames = Object.keys(trash)
    const directionSet = new Set<string>(DIRECTION_LABELS)
    for (const n of profiledNames) {
      const d = profiles[n]?.direction
      if (typeof d === 'string' && d !== '') directionSet.add(d)
    }
    const directionOptions = Array.from(directionSet)

    const chip = (label: string, value: string, count?: number) => (
      <button
        key={value}
        type="button"
        className={`${css.chip}${filter === value ? ` ${css.chipActive}` : ''}`}
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
              ? <span className={`${css.badge} ${css.badgeOk}`}>{p.direction}</span>
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
              : active ? <Btn label="停用" onClick={() => uninstall(name)} /> : null}
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
          {directionOptions.map((d) => chip(d, d))}
          {ORIGIN_KEYS.map((k) => chip(ORIGIN_LABELS[k], k))}
        </div>
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

  // ---------- 匹配 ----------

  const matchBody = () => (
    <div className={css.form}>
      <input
        className={css.search}
        type="text"
        placeholder="描述当前任务，从已建档技能里找最合适的…"
        value={matchQuery}
        autoFocus
        onChange={(e) => setMatchQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') runMatch() }}
      />
      <div className={css.detailActions}>
        <Btn label={matchBusy ? '匹配中…' : '匹配'} kind="primary" onClick={runMatch} />
      </div>
      {matchError !== '' ? <div className={css.notice}>{matchError}</div> : null}
      {matches === null
        ? <div className={css.hint}>输入任务描述后点「匹配」，例如「帮我写一个登录页面」「调研某行业前景」。</div>
        : matches.length === 0
          ? <div className={css.hint}>没有匹配的已建档技能。</div>
          : (
            <>
              <div className={css.sectionTitle}>匹配结果（{matches.length} / {matchTotal} 已建档）</div>
              <div className={css.list}>
                {matches.map((m) => (
                  <div key={m.name} className={css.row}>
                    <div className={css.rowMain}>
                      <div className={css.rowName}>
                        {m.name}
                        <span className={`${css.badge} ${css.badgeOk}`}>{m.direction}</span>
                        <span className={css.badge}>相关度 {m.score}</span>
                      </div>
                      <div className={css.rowDesc}>{m.useScope}</div>
                      {m.matched.length > 0 ? <div className={css.rowDesc}>命中：{m.matched.join(' · ')}</div> : null}
                    </div>
                    <Btn label="调用" kind="primary" onClick={() => invoke(m.name)} />
                  </div>
                ))}
              </div>
            </>
          )}
    </div>
  )

  // ---------- 使用统计 ----------

  const fmtDay = (ts: number) => {
    const d = new Date(ts)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  }

  const usageBody = () => {
    const entries = Object.entries(usage)
      .map(([name, rec]) => {
        const activeDays = Object.keys(rec.daily).length
        const callsPerDay = activeDays === 0 ? rec.count : Math.round((rec.count / activeDays) * 10) / 10
        return { name, rec, activeDays, callsPerDay }
      })
      .sort((a, b) => b.rec.count - a.rec.count || b.rec.lastUsedAt - a.rec.lastUsedAt || a.name.localeCompare(b.name))
    const totalCalls = entries.reduce((acc, e) => acc + e.rec.count, 0)
    const dailyText = (rec: UsageRecord) => Object.entries(rec.daily)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([d, n]) => `${d.slice(5)}×${n}`)
      .join(' ')
    return (
      <>
        {entries.length === 0
          ? <div className={css.hint}>还没有调用记录。技能被 skill 工具加载、或用户用 /name 手势调用后会自动记录。</div>
          : (
            <>
              <div className={css.sectionTitle}>共 {entries.length} 个技能被调用过（总计 {totalCalls} 次）</div>
              <div className={css.list}>
                {entries.map(({ name, rec, activeDays, callsPerDay }) => (
                  <div key={name} className={css.row}>
                    <div className={css.rowMain}>
                      <div className={css.rowName}>
                        {name}
                        <span className={`${css.badge} ${css.badgeOk}`}>{rec.count} 次</span>
                        <span className={css.badge}>平均 {callsPerDay} 次/天</span>
                      </div>
                      <div className={css.rowDesc}>
                        首次 {fmtDay(rec.firstUsedAt)} · 最近 {fmtDay(rec.lastUsedAt)} · 活跃 {activeDays} 天
                      </div>
                      <div className={css.rowDesc}>近 6 天：{dailyText(rec) || '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
      </>
    )
  }

  // ---------- 汇报（调用 dsh-report 后端 /api/report） ----------

  const reportRpc = async <T,>(method: string, args?: unknown): Promise<T> => {
    const res = await fetch('/api/report', {
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

  const loadReport = (view: ReportView = reportView) => {
    setReportLoading(true)
    setReportError('')
    setReportNotice('')
    setReportData(null)
    const method = view === 'monthly' ? 'generateMonthly' : 'generateDaily'
    reportRpc<ReportData>(method, { sessionId })
      .then((data) => {
        if (typeof data.lastError === 'string' && data.lastError !== '') {
          setReportError(data.lastError)
          setReportData(null)
        } else {
          setReportData(data)
        }
        setReportLoading(false)
      })
      .catch((error: unknown) => { setReportError(String(error)); setReportLoading(false) })
  }

  const runReview = () => {
    setReportBusy(true)
    setReportError('')
    setReportNotice('')
    reportRpc<{ ok: boolean; message?: string; error?: string }>('review', { sessionId })
      .then((res) => {
        setReportBusy(false)
        setReportNotice(res?.ok ? (res.message ?? '已触发复盘') : (res?.error ?? '复盘失败'))
      })
      .catch((error: unknown) => { setReportBusy(false); setReportError(String(error)) })
  }

  const runExport = () => {
    setReportBusy(true)
    setReportError('')
    setReportNotice('')
    reportRpc<{ ok: boolean; error?: string; jsonPath?: string; mdPath?: string }>('export', { sessionId, view: reportView })
      .then((res) => {
        setReportBusy(false)
        setReportNotice(res?.ok ? `已导出：${res.mdPath}、${res.jsonPath}` : (res?.error ?? '导出失败'))
      })
      .catch((error: unknown) => { setReportBusy(false); setReportError(String(error)) })
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
    else if (reportError !== '') content = <div className={css.notice}>{reportError}</div>
    else if (reportNotice !== '') content = <div className={css.reportNotice}>{reportNotice}</div>
    else if (data !== null) {
      if (reportView === 'monthly' && 'days' in data) {
        const monthly = data as ReportMonthly
        content = (
          <>
            <div className={css.reportSec}>
              <div className={css.sectionTitle}>
                按日（{monthly.month}）{monthly.fallbackMonth ? ` · 回退自 ${monthly.fallbackMonth}` : ''}
              </div>
              {(monthly.days ?? []).length === 0
                ? <div className={css.hint}>该月暂无记录。</div>
                : (
                  <table className={css.reportTable}>
                    <thead>
                      <tr><th>日期</th><th>项目</th><th>进度</th><th>待办</th><th>问题</th></tr>
                    </thead>
                    <tbody>
                      {monthly.days.map((day) => (
                        <tr key={day.date}>
                          <td>{day.date}</td>
                          <td>{(day.projects ?? []).join('、')}</td>
                          <td>{(day.progress ?? []).join('；')}</td>
                          <td>{(day.todo ?? []).join('；')}</td>
                          <td>{(day.issues ?? []).join('；')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
            {reportProjects(monthly.projects)}
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
          <button type="button" className={`${css.reportViewBtn}${reportView === 'daily' ? ` ${css.reportViewBtnActive}` : ''}`} disabled={reportBusy} onClick={() => { setReportView('daily'); loadReport('daily') }}>日报</button>
          <button type="button" className={`${css.reportViewBtn}${reportView === 'monthly' ? ` ${css.reportViewBtnActive}` : ''}`} disabled={reportBusy} onClick={() => { setReportView('monthly'); loadReport('monthly') }}>月度</button>
          <button type="button" className={css.reportViewBtn} disabled={reportBusy} onClick={runReview}>复盘</button>
          <button type="button" className={css.reportViewBtn} disabled={reportBusy} onClick={runExport}>导出</button>
        </div>
        {content}
      </div>
    )
  }

  // ---------- 骨架 ----------

  const headerTitle = tab === 'archive' ? '技能档案' : tab === 'match' ? '技能匹配' : tab === 'usage' ? '使用统计' : tab === 'report' ? '汇报' : view === 'create' ? '新建技能' : view === 'detail' ? '技能详情' : '管理'

  return (
    <div className={css.wrap} data-theme={scheme}>
      <button
        type="button"
        className={`${css.toggle}${open ? ` ${css.toggleActive}` : ''}`}
        title="管理：技能全生命周期 + 汇报"
        onClick={() => setOpen(!open)}
      >
        管理
      </button>
      {open ? (
        <div className={css.panel} onKeyDown={onKeyDown}>
          <div className={css.header}>
            <span className={css.title}>{headerTitle}</span>
            {tab === 'skills' && view === 'list'
              ? <Btn label="新建" onClick={() => { setNotice(''); setView('create') }} />
              : null}
            <button type="button" className={css.btn} aria-label="关闭" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className={css.tabs}>
            <button type="button" className={`${css.tab}${tab === 'skills' ? ` ${css.tabActive}` : ''}`} onClick={() => { setTab('skills'); setView('list'); setDetail(null); setNotice('') }}>技能</button>
            <button type="button" className={`${css.tab}${tab === 'match' ? ` ${css.tabActive}` : ''}`} onClick={() => { setTab('match'); setNotice('') }}>匹配</button>
            <button type="button" className={`${css.tab}${tab === 'archive' ? ` ${css.tabActive}` : ''}`} onClick={() => { setTab('archive'); setNotice('') }}>档案</button>
            <button type="button" className={`${css.tab}${tab === 'usage' ? ` ${css.tabActive}` : ''}`} onClick={() => { setTab('usage'); setNotice('') }}>统计</button>
            <button type="button" className={`${css.tab}${tab === 'report' ? ` ${css.tabActive}` : ''}`} onClick={() => { setTab('report'); setNotice(''); if (reportData === null && !reportLoading) loadReport() }}>汇报</button>
          </div>
          {notice !== '' ? <div className={css.notice}>{notice}</div> : null}
          {tab === 'match'
            ? matchBody()
            : tab === 'archive'
              ? archiveBody()
              : tab === 'usage'
                ? usageBody()
                : tab === 'report'
                  ? reportBody()
                  : view === 'list' ? listBody() : view === 'detail' ? detailBody() : createBody()}
          <div className={`${css.hint} ${css.footer}`}>
            来源标注：自创=自己创建 · 外来=下载/他人 · 系统=随 DSH 内置 · 未标注=尚未标记（点击徽标即可切换）。
            新加入 .dsh/skills 或 ~/.dsh/skills 的技能会自动出现在「技能」页；档案保存在 {'<工作区>'}/.dsh/skill-manager/index.json。
          </div>
        </div>
      ) : null}
    </div>
  )
}
