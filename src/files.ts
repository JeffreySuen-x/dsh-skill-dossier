/**
 * 纯函数：跨平台路径解析与 shell 命令生成。
 *
 * 路径操作通过注入的 {@link PathFns}（node:path 的 posix/win32 实现）完成，
 * 命令生成按 `isWindows` 分支（bash vs pwsh），使 Windows 行为能在非 Windows
 * 机器上直接单测，而无需真机。
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
}

/** 默认按运行平台（node:path）。 */
export const defaultPath: PathFns = path

/** 判断 candidate 词法解析后是否仍在 dir 目录内（解析 `..`，不解析符号链接）。
 * `relative` 在跨盘（Windows）时返回目标绝对路径，故用 isAbsolute 一并拦截。 */
export function isWithin(candidate: string, dir: string, p: PathFns = defaultPath): boolean {
  const rel = p.relative(p.resolve(dir), p.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel))
}

interface MovableSkill { name: string; path?: string }

/** 从注册表定义解析可移动的文件系统条目（只信任注册表给的路径）。 */
export function fsEntryOf(skill: MovableSkill, p: PathFns = defaultPath): { entry: string; root: string } | undefined {
  if (typeof skill.path !== 'string') return undefined
  const base = p.basename(skill.path)
  if (base === 'SKILL.md') {
    const dir = p.dirname(skill.path)
    if (p.basename(dir) !== skill.name) return undefined
    return { entry: dir, root: p.dirname(dir) }
  }
  if (base === `${skill.name}.md`) {
    return { entry: skill.path, root: p.dirname(skill.path) }
  }
  return undefined
}

/** trash 目录：与技能根同级（技能根父目录下的 skill-manager/trash）。 */
export function trashDirOf(root: string, p: PathFns = defaultPath): string {
  return p.join(p.dirname(root), 'skill-manager', 'trash')
}

/** 把值转成 shell 单引号参数（POSIX 用 '\''，pwsh 用 ''）。 */
export function quoteShellArg(value: string, isWindows: boolean): string {
  const v = String(value)
  return isWindows ? `'${v.replaceAll("'", "''")}'` : `'${v.replaceAll("'", "'\\''")}'`
}

export function mkdirCommand(dir: string, isWindows: boolean): string {
  return isWindows
    ? `[System.IO.Directory]::CreateDirectory(${quoteShellArg(dir, true)}) | Out-Null`
    : `mkdir -p ${quoteShellArg(dir, isWindows)}`
}

function posixIdentityCommand(target: string): string {
  const value = quoteShellArg(target, false)
  return `stat -c '%d:%i' -- ${value} 2>/dev/null || stat -f '%d:%i' -- ${value} 2>/dev/null`
}

export function moveNoClobberCommand(src: string, dst: string, isWindows: boolean): string {
  const source = quoteShellArg(src, isWindows)
  const destination = quoteShellArg(dst, isWindows)
  if (isWindows) {
    return `if ([System.IO.Directory]::Exists(${source})) { [System.IO.Directory]::Move(${source}, ${destination}) } elseif ([System.IO.File]::Exists(${source})) { [System.IO.File]::Move(${source}, ${destination}) } else { throw 'source missing' }`
  }
  const nestedPath = path.posix.join(dst, path.posix.basename(src))
  const destinationParentPath = path.posix.dirname(dst)
  const nested = quoteShellArg(nestedPath, false)
  const sourceIdentity = posixIdentityCommand(src)
  const destinationParentIdentity = posixIdentityCommand(destinationParentPath)
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

export function removeRecursiveCommand(path: string, isWindows: boolean): string {
  return isWindows
    ? `Remove-Item -Recurse -Force -LiteralPath ${quoteShellArg(path, true)}`
    : `rm -rf -- ${quoteShellArg(path, isWindows)}`
}

/** Replace a file by renaming a same-directory temporary file over it. */
export function atomicReplaceCommand(src: string, dst: string, isWindows: boolean): string {
  return isWindows
    ? `[System.IO.File]::Move(${quoteShellArg(src, true)}, ${quoteShellArg(dst, true)}, $true)`
    : `mv -f -- ${quoteShellArg(src, false)} ${quoteShellArg(dst, false)}`
}

/** Remove one staging file without interpreting wildcard characters. */
export function removeFileCommand(path: string, isWindows: boolean): string {
  return isWindows
    ? `Remove-Item -Force -LiteralPath ${quoteShellArg(path, true)}`
    : `rm -f -- ${quoteShellArg(path, false)}`
}
