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
    ? `New-Item -ItemType Directory -Force -Path ${quoteShellArg(dir, isWindows)} | Out-Null`
    : `mkdir -p ${quoteShellArg(dir, isWindows)}`
}

export function moveNoClobberCommand(src: string, dst: string, isWindows: boolean): string {
  return isWindows
    ? `Move-Item -Path ${quoteShellArg(src, isWindows)} -Destination ${quoteShellArg(dst, isWindows)}`
    : `mv -n ${quoteShellArg(src, isWindows)} ${quoteShellArg(dst, isWindows)}`
}

export function removeRecursiveCommand(path: string, isWindows: boolean): string {
  return isWindows
    ? `Remove-Item -Recurse -Force -Path ${quoteShellArg(path, isWindows)}`
    : `rm -rf -- ${quoteShellArg(path, isWindows)}`
}
