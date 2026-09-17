/**
 * 技能根扫描（host 半，纯函数 + 注入的文件访问）。
 *
 * 为什么需要它：宿主的 skill 注册表**只返回赢家**——同名的落败者只留一行
 * `logger.warn`，且 README 明确写着「没有 API 可检查全部被遮蔽的定义」。
 * 于是「我改的那个文件到底生不生效」「两个根里哪份在跑」这两个问题，
 * 靠注册表永远答不出来。本模块自己扫盘，把被遮蔽者也摆到台面上。
 *
 * 三件事都在这里算，全部零模型调用：
 *   1. 每个技能出现在哪些根、谁是赢家、同名副本内容是否分叉；
 *   2. 上下文成本三层：目录（name + 截断后 description）/ 正文 / 资源包；
 *   3. 内容指纹——档案页据此知道「建档之后正文被改过」。
 *
 * 扫描口径与宿主 `dsh-skill-filesystem` 对齐（README「发现流程」）：
 * 只看被扫描根的**直接子目录**（内含 `SKILL.md`）或**平铺 `<name>.md`**，
 * 刻意不支持嵌套 `**​/SKILL.md`；root 用 rank 升序先到先得，与注册表同规则。
 */

/** 一个被扫描的技能根。rank 与 `dsh-skill-filesystem` 的默认根表一致。 */
export interface SkillRoot {
  /** 与宿主同义的来源标签（project-dsh / user-dsh / …）。 */
  source: string
  /** 越小越优先；同名先到先得。 */
  rank: number
  /** 根目录绝对路径。 */
  path: string
}

/** 默认根表（rank 与来源名照抄 `dsh-skill-filesystem/README.zh.md` 的优先级表）。 */
export function defaultSkillRoots(options: { projectRoot: string; dshHome: string; agentsHome: string }): SkillRoot[] {
  return [
    { source: 'project-dsh', rank: 100, path: joinRoot(options.projectRoot, '.dsh', 'skills') },
    { source: 'project-agents', rank: 200, path: joinRoot(options.projectRoot, '.agents', 'skills') },
    { source: 'user-dsh', rank: 400, path: joinRoot(options.dshHome, 'skills') },
    { source: 'user-agents', rank: 500, path: joinRoot(options.agentsHome, 'skills') },
  ]
}

/** POSIX 拼接，只在 host 组装根路径时用；真实路径解析交给注入的 PathFns。 */
function joinRoot(...parts: string[]): string {
  return parts
    .map((part, index) => (index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, '')))
    .filter((part) => part !== '')
    .join('/')
}

/** 扫描用到的文件访问子集（与 @deepseek-ai/dsh-fs 的 FsService 同形）。 */
export interface ScanFs {
  /** 解析路径，返回可传给 readText / listDir / stat 的 target。 */
  resolve(path: string): Promise<{ targetKey: string }>
  /** 读取文本；文件不存在等失败直接抛。 */
  readText(target: { targetKey: string }): Promise<string>
  /** 列目录，返回 `{ name, type, target }`；不是目录或不存在时抛。 */
  listDir(target: { targetKey: string }): Promise<ScanDirEntry[]>
  /** 探测单个路径（**跟随**符号链接），缺失返回 undefined。 */
  stat(target: { targetKey: string }): Promise<{ type: string; size?: number } | undefined>
}

/**
 * `listDir` 的条目。
 *
 * `type` 取自 dsh-fs-local 的 `pathType()`：`file` / `directory` / `other`。
 * ⚠️ 它是**跟随符号链接后**的类型；但本插件的**测试替身**（以及任何按
 * `dirent.isDirectory()` 实现的替身）会把「指向目录的软链」报成 `other`——
 * 本机 31 个技能正是以软链形式挂进来的，按 dirent 判定会全部漏掉。
 * 因此 `type` 只当**提示**，真正的判定一律走 {@link ScanFs.stat}。
 */
export interface ScanDirEntry {
  name: string
  type: string
  target: { targetKey: string }
}

/** 磁盘上的一个技能条目（可能是被遮蔽的副本）。 */
export interface ScannedSkill {
  /** frontmatter `name`，缺失或非法时回落目录名 / 文件名。 */
  name: string
  /** 目录名（bundle）或文件名去掉 `.md`（平铺）。用于判断目录名是否等于技能名。 */
  dirName: string
  source: string
  rank: number
  /** 技能根绝对路径。 */
  root: string
  /** bundle 目录或平铺文件的绝对路径。 */
  entry: string
  /** `SKILL.md` 的绝对路径（平铺技能就是文件本身）。 */
  skillPath: string
  /** frontmatter `description` 原文（不截断）。 */
  description: string
  /** `SKILL.md` 字节数。 */
  bodyBytes: number
  /** `SKILL.md` 全文的 sha256 前 16 位。 */
  hash: string
  /** 整份正文的 token 估算（加载一次要付的成本）。 */
  bodyTokens: number
  /** 目录行成本：name + 宿主截断后的 description。 */
  catalogTokens: number
  /** 资源包（正文之外）的字节数与文件数；扫描失败时为 0。 */
  assetBytes: number
  assetFiles: number
}

/** 一个技能名在多个根里的全部副本。 */
export interface ScannedConflict {
  name: string
  /** 按 rank 升序；第一个是赢家。 */
  copies: ScannedSkill[]
  /** 所有副本的 `SKILL.md` 是否字节相同。 */
  identical: boolean
}

/** 一次扫描的汇总。 */
export interface ScanSummary {
  roots: SkillRoot[]
  /** 磁盘条目总数（含被遮蔽副本）。 */
  entries: number
  /** 去重后的赢家数。 */
  winners: number
  /** 目录常驻成本合计（≈token，宿主口径）。 */
  catalogTokens: number
  /** 全部赢家正文加载一次的合计（≈token）。 */
  bodyTokens: number
  /** 全部赢家资源包字节合计。 */
  assetBytes: number
  /** description 超过宿主 500 字符上限、被静默截断的技能名。 */
  truncatedDescriptions: string[]
  /** 目录名与技能名不一致的技能名。 */
  nameMismatches: string[]
  conflicts: ScannedConflict[]
}

export interface ScanResult {
  skills: ScannedSkill[]
  summary: ScanSummary
}

/** 宿主 `dsh-tool-skill` 的目录描述上限（`catalogDescriptionMaxLength` 默认值）。 */
export const CATALOG_DESCRIPTION_MAX_LENGTH = 500

/**
 * 目录成本估算：CJK 按 1 token/字，其余按 4 字符/token（cl100k 量级）。
 * 与 `tokens.ts` 同口径——那份给 UI，这份给扫描，避免循环依赖此处重复一份。
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const char of String(text ?? '')) {
    if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char)) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

/**
 * 宿主渲染目录时对 description 做的规范化：折叠空白 → 截到上限 + `...`。
 * 照抄 `dsh-tool-skill/lib/index.js` 的 `catalogDescription()`。
 */
export function catalogDescription(description: string, maxLength = CATALOG_DESCRIPTION_MAX_LENGTH): string {
  const normalized = String(description ?? '').replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 从 `SKILL.md` 开头解析 frontmatter 里我们要用的标量。
 *
 * 刻意只做「行内 `key: value`」这一种形态：宿主用完整 YAML 解析并对坏 YAML
 * 直接丢弃该技能，而这里的目标是**让坏技能可见**，不是替宿主决定它能不能用。
 * 因此解析失败不抛错——拿不到就是空值，浮出到面板上比静默跳过有用。
 */
export function parseFrontmatter(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  if (typeof text !== 'string' || !text.startsWith('---')) return fields
  const end = text.indexOf('\n---', 3)
  if (end < 0) return fields
  for (const rawLine of text.slice(3, end).split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(rawLine)
    if (match === null) continue
    const key = match[1]!
    let value = match[2]!.trim()
    if (value === '' || value === '>' || value === '|' || value.startsWith('>') || value.startsWith('|')) continue
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/[ \t]+#.*$/, '')
    }
    fields[key] = value.trim()
  }
  return fields
}

/**
 * 扫描全部技能根。
 *
 * 失败策略：**缺失的根是正常状态**（返回空），**单个条目的读取失败被跳过而不是
 * 让整次扫描失败**——一个坏技能不该让面板整个空白。这与宿主
 * `dsh-skill-filesystem` 的取舍一致（「已确认缺失的路径属于有效空状态」）。
 */
export async function scanSkillRoots(
  fs: ScanFs,
  roots: SkillRoot[],
  deps: { hash: (text: string) => string },
): Promise<ScanResult> {
  const skills: ScannedSkill[] = []
  const sorted = [...roots].sort((a, b) => a.rank - b.rank || a.source.localeCompare(b.source))

  for (const root of sorted) {
    let rootTarget: { targetKey: string }
    try {
      rootTarget = await fs.resolve(root.path)
    } catch {
      continue
    }
    let entries: ScanDirEntry[]
    try {
      entries = await fs.listDir(rootTarget)
    } catch {
      continue
    }
    for (const entry of entries) {
      const scanned = await scanEntry(fs, root, entry, deps)
      if (scanned !== undefined) skills.push(scanned)
    }
  }

  const byName = new Map<string, ScannedSkill[]>()
  for (const skill of skills) {
    const list = byName.get(skill.name)
    if (list === undefined) byName.set(skill.name, [skill])
    else list.push(skill)
  }
  for (const list of byName.values()) {
    list.sort((a, b) => a.rank - b.rank || a.source.localeCompare(b.source) || a.entry.localeCompare(b.entry))
  }

  const winners = [...byName.values()].map((list) => list[0]!)
  const conflicts: ScannedConflict[] = []
  for (const [name, copies] of byName) {
    if (copies.length < 2) continue
    conflicts.push({ name, copies, identical: copies.every((copy) => copy.hash === copies[0]!.hash) })
  }
  conflicts.sort((a, b) => Number(a.identical) - Number(b.identical) || b.copies.length - a.copies.length || a.name.localeCompare(b.name))

  const summary: ScanSummary = {
    roots: sorted,
    entries: skills.length,
    winners: winners.length,
    catalogTokens: winners.reduce((total, skill) => total + skill.catalogTokens, 0),
    bodyTokens: winners.reduce((total, skill) => total + skill.bodyTokens, 0),
    assetBytes: winners.reduce((total, skill) => total + skill.assetBytes, 0),
    truncatedDescriptions: winners
      .filter((skill) => skill.description.replace(/\s+/g, ' ').trim().length > CATALOG_DESCRIPTION_MAX_LENGTH)
      .map((skill) => skill.name),
    nameMismatches: winners.filter((skill) => skill.dirName !== skill.name).map((skill) => skill.name),
    conflicts,
  }
  return { skills, summary }
}

async function scanEntry(
  fs: ScanFs,
  root: SkillRoot,
  entry: ScanDirEntry,
  deps: { hash: (text: string) => string },
): Promise<ScannedSkill | undefined> {
  const entryPath = joinRoot(root.path, entry.name)
  // 类型一律以 stat 为准（跟随软链）：`entry.type` 来自 dirent，对目录软链会答
  // 「other」，只能当提示、不能当判据——见 ScanDirEntry 注释。故这里不再读它。
  let info
  try {
    info = await fs.stat(entry.target)
  } catch {
    return undefined
  }
  if (info === undefined) return undefined
  const isDir = info.type === 'directory'
  let skillPath: string
  let dirName: string
  if (isDir) {
    skillPath = joinRoot(entryPath, 'SKILL.md')
    dirName = entry.name
  } else if (info.type === 'file' && entry.name.endsWith('.md')) {
    skillPath = entryPath
    dirName = entry.name.slice(0, -3)
  } else {
    return undefined
  }

  let text: string
  try {
    text = await fs.readText(await fs.resolve(skillPath))
  } catch {
    return undefined
  }
  const fields = parseFrontmatter(text)
  const declared = fields['name'] ?? ''
  const name = SKILL_NAME_RE.test(declared) ? declared : dirName
  const description = fields['description'] ?? ''
  const assets = isDir ? await measureAssets(fs, entry.target) : { bytes: 0, files: 0 }

  return {
    name,
    dirName,
    source: root.source,
    rank: root.rank,
    root: root.path,
    entry: entryPath,
    skillPath,
    description,
    bodyBytes: Buffer.byteLength(text, 'utf8'),
    hash: deps.hash(text),
    bodyTokens: estimateTokens(text),
    catalogTokens: estimateTokens(`${name} ${catalogDescription(description)}`),
    assetBytes: assets.bytes,
    assetFiles: assets.files,
  }
}

/**
 * 递归统计 bundle 里正文之外的资源体积。
 *
 * `ponytail:` 上限——只在**赢家**上调用（由调用方保证），深度封顶 8 层。
 * 每个条目都要 `stat` 一次（为拿到跟随软链后的真实类型），所以资源包越大
 * 这一趟越贵：本机 `obsidian-second-brain` 有 328 个文件，一次全扫约几十毫秒。
 * 若技能数涨到几百、或根目录落在网络盘上，这里要换成带并发上限的遍历。
 */
async function measureAssets(
  fs: ScanFs,
  dirTarget: { targetKey: string },
  depth = 0,
): Promise<{ bytes: number; files: number }> {
  if (depth > 8) return { bytes: 0, files: 0 }
  let entries: ScanDirEntry[]
  try {
    entries = await fs.listDir(dirTarget)
  } catch {
    return { bytes: 0, files: 0 }
  }
  let bytes = 0
  let files = 0
  for (const entry of entries) {
    let info: { type: string; size?: number } | undefined
    try {
      info = await fs.stat(entry.target)
    } catch {
      continue
    }
    if (info === undefined) continue
    if (info.type === 'directory') {
      const nested = await measureAssets(fs, entry.target, depth + 1)
      bytes += nested.bytes
      files += nested.files
      continue
    }
    if (info.type !== 'file') continue
    if (entry.name === 'SKILL.md' && depth === 0) continue
    files += 1
    if (typeof info.size === 'number') bytes += info.size
  }
  return { bytes, files }
}
