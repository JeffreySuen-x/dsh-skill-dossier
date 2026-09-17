/**
 * 纯函数：路径解析与 POSIX shell 命令生成。
 *
 * 路径操作通过注入的 {@link PathFns} 完成，命令生成一律是 bash/POSIX —— 本插件
 * 只支持 macOS 与 Linux。**Windows 支持已在 2026-09-17 撤除**：那条支线（pwsh
 * 命令、`MoveFileExW` 原生移动）从未在真机上被验证过，却让 CI 长期挂着一条红腿，
 * 而一个常红的门会吃掉它后面所有门的信号——要恢复就得先有真机验证，别只把分支加回来。
 */
import * as path from 'node:path'

/** 本模块用到的最小路径操作子集。 */
export interface PathFns {
  basename(p: string): string
  dirname(p: string): string
  join(...parts: string[]): string
  resolve(...parts: string[]): string
  relative(from: string, to: string): string
  isAbsolute(p: string): boolean
  sep: string
}

/** 默认按运行平台（node:path）。 */
export const defaultPath: PathFns = path

/**
 * 判断 candidate 词法解析后是否仍在 dir 目录内（解析 `..`，不解析符号链接）。
 *
 * 判据必须是**按路径段**比较：早期版本用 `rel.startsWith('..')`，于是 `<dir>/..foo/x`
 * 这种名字以 `..` 开头的正常子目录会被误判成「在外面」。这不是纯美观问题——调用方
 * 拿它决定沙箱档位（`isWithin(target, ws) ? 'workspace-write' : 'danger-full-access'`），
 * 误判会把本可受限执行的 `mv`/`rm -rf` 升格成全权执行。
 *
 * `relative` 跨盘（Windows）时返回目标绝对路径，故用 isAbsolute 一并拦截。
 */
export function isWithin(candidate: string, dir: string, p: PathFns = defaultPath): boolean {
  const rel = p.relative(p.resolve(dir), p.resolve(candidate))
  if (rel === '') return true
  if (p.isAbsolute(rel)) return false
  return !rel.split(p.sep).includes('..')
}

interface MovableSkill { name: string; path?: string }

/**
 * 从注册表定义解析可移动的文件系统条目（只信任注册表给的路径）。
 *
 * 判据是**路径形状**，不是「目录名等于技能名」：只要注册表给的 `path` 是
 * `<root>/<dir>/SKILL.md` 或 `<root>/<name>.md`，root 就由路径反推。
 * 早期版本额外要求 `basename(dirname(path)) === skill.name`，于是目录名与
 * frontmatter `name` 不一致的技能（本机实测 4 个：`book-to-skill-master`、
 * `god-skill-main` 等）会被误判成「不是文件系统技能」，生命周期操作全废。
 * 目录名是源仓库的目录名，frontmatter `name` 才是调用名——两者不必然相等。
 *
 * 路径必须是绝对的：`'SKILL.md'` 这种相对路径会反推出 `root: '..'`，而 root 会喂给
 * `trashDirOf()` 与 `rm -rf`，entry 会作为 `mv` 的源（cwd = root）。
 */
export function fsEntryOf(skill: MovableSkill, p: PathFns = defaultPath): { entry: string; root: string } | undefined {
  if (typeof skill.path !== 'string' || !p.isAbsolute(skill.path)) return undefined
  const base = p.basename(skill.path)
  if (base === 'SKILL.md') {
    const dir = p.dirname(skill.path)
    return { entry: dir, root: p.dirname(dir) }
  }
  // 平铺技能：<root>/<name>.md。只认与技能同名的单文件，避免把任意 .md 当技能。
  if (base === `${skill.name}.md`) {
    return { entry: skill.path, root: p.dirname(skill.path) }
  }
  return undefined
}

/** trash 目录：与技能根同级（技能根父目录下的 skill-manager/trash）。 */
export function trashDirOf(root: string, p: PathFns = defaultPath): string {
  return p.join(p.dirname(root), 'skill-manager', 'trash')
}

/** 把值转成 shell 单引号参数（POSIX：内嵌单引号写成 '\''）。 */
export function quoteShellArg(value: string): string {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

export function mkdirCommand(dir: string): string {
  return `mkdir -p ${quoteShellArg(dir)}`
}

function posixIdentityCommand(target: string, followSymlink = false): string {
  const value = quoteShellArg(target)
  const dereference = followSymlink ? '-L ' : ''
  return `stat ${dereference}-c '%d:%i' -- ${value} 2>/dev/null || stat ${dereference}-f '%d:%i' -- ${value} 2>/dev/null`
}

export function moveNoClobberCommand(src: string, dst: string): string {
  const source = quoteShellArg(src)
  const destination = quoteShellArg(dst)
  const nestedPath = path.posix.join(dst, path.posix.basename(src))
  const destinationParentPath = path.posix.dirname(dst)
  const nested = quoteShellArg(nestedPath)
  const sourceIdentity = posixIdentityCommand(src)
  const destinationParentIdentity = posixIdentityCommand(destinationParentPath, true)
  const destinationIdentity = posixIdentityCommand(dst)
  const nestedIdentity = posixIdentityCommand(nestedPath)
  // trash 与 skill root 预期同盘；跨设备 mv 会 copy+unlink 并改变 inode，
  // 因此在移动前安全拒绝，避免把合法复制误判为竞态后留下 orphan。
  return `source_id=$(${sourceIdentity}) || { echo 'source missing' >&2; exit 18; }; `
    + `destination_parent_id=$(${destinationParentIdentity}) || { echo 'destination parent missing' >&2; exit 18; }; `
    + `source_device=\${source_id%%:*}; destination_device=\${destination_parent_id%%:*}; `
    + `if [ "$source_device" != "$destination_device" ]; then echo 'cross-device move is not supported' >&2; exit 18; fi; `
    + `if [ -e ${destination} ] || [ -L ${destination} ]; then echo 'destination exists' >&2; exit 17; fi; `
    + `mv -n -- ${source} ${destination} || exit $?; `
    + `destination_id=$(${destinationIdentity}) || destination_id=''; `
    + `if [ "$source_id" = "$destination_id" ]; then exit 0; fi; `
    + `nested_id=$(${nestedIdentity}) || nested_id=''; `
    + `if [ "$source_id" = "$nested_id" ] && [ ! -e ${source} ] && [ ! -L ${source} ]; then `
    + `mv -n -- ${nested} ${source} || { echo 'move race recovery failed' >&2; exit 19; }; `
    + `restored_id=$(${sourceIdentity}) || restored_id=''; `
    + `if [ "$source_id" != "$restored_id" ]; then echo 'move race recovery failed' >&2; exit 19; fi; fi; `
    + `echo 'destination changed during move' >&2; exit 18`
}

export function removeRecursiveCommand(path: string): string {
  return `rm -rf -- ${quoteShellArg(path)}`
}

/** Replace a file by renaming a same-directory temporary file over it. */
export function atomicReplaceCommand(src: string, dst: string): string {
  return `mv -f -- ${quoteShellArg(src)} ${quoteShellArg(dst)}`
}

/** Remove one staging file without interpreting wildcard characters. */
export function removeFileCommand(path: string): string {
  return `rm -f -- ${quoteShellArg(path)}`
}
