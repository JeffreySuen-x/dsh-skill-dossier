/**
 * `src/files.ts` 的纯函数：词法路径判据 + POSIX 命令生成。
 *
 * 这两块都不碰磁盘，正好能在无 DOM、无 shell 的环境里直接断言生成的命令文本。
 * 真跑 `/bin/sh` 的行为回归在 `tests/path.spec.ts`。
 */
import { describe, expect, it } from 'vitest'
import {
  atomicReplaceCommand,
  fsEntryOf,
  isWithin,
  mkdirCommand,
  moveNoClobberCommand,
  quoteShellArg,
  removeFileCommand,
  removeRecursiveCommand,
} from '../src/files.ts'

describe('isWithin（词法路径判据）', () => {
  const trash = '/root/.dsh/skill-manager/trash'

  it('接受 trash 目录的直接子项', () => {
    expect(isWithin(`${trash}/skill-1`, trash)).toBe(true)
  })

  it('接受 trash 目录自身', () => {
    expect(isWithin(trash, trash)).toBe(true)
  })

  it('拒绝 `..` 穿越出 trash', () => {
    expect(isWithin(`${trash}/../../../etc/passwd`, trash)).toBe(false)
  })

  it('拒绝共享前缀的兄弟目录', () => {
    expect(isWithin('/root/.dsh/skill-manager/trash-evil/x', trash)).toBe(false)
  })

  // 回归：判据必须按路径段比较。`startsWith('..')` 会把首段以 `..` 开头的
  // 正常子目录误判成「在外面」，而调用方拿它决定沙箱档位（误判 = 升格到全权执行）。
  it('接受名字以 `..` 开头的子目录', () => {
    expect(isWithin(`${trash}/..foo/bar`, trash)).toBe(true)
    expect(isWithin(`${trash}/...`, trash)).toBe(true)
  })
})

describe('命令生成（POSIX）', () => {
  it('单引号参数：普通路径原样、内嵌单引号按 POSIX 规则闭合再转义', () => {
    expect(quoteShellArg('/a b')).toBe("'/a b'")
    expect(quoteShellArg("/a'b")).toBe("'/a'\\''b'")
  })

  it('mkdir 用 -p', () => {
    expect(mkdirCommand('/a b')).toBe("mkdir -p '/a b'")
  })

  it('move 不覆盖、跨设备先拒、竞态可回滚', () => {
    const command = moveNoClobberCommand('/s', '/d')
    expect(command).toContain("if [ -e '/d' ] || [ -L '/d' ]")
    expect(command).toContain("mv -n -- '/s' '/d'")
    expect(command).toContain("&& [ ! -e '/s' ] && [ ! -L '/s' ]")
    expect(command).toContain('cross-device move is not supported')
  })

  it('remove 用 -- 与字面路径', () => {
    expect(removeRecursiveCommand('/x')).toBe("rm -rf -- '/x'")
    expect(removeFileCommand('/a[b]/temp')).toBe("rm -f -- '/a[b]/temp'")
  })

  it('原子替换是同目录 rename', () => {
    expect(atomicReplaceCommand('/a/temp', '/a/index.json')).toBe("mv -f -- '/a/temp' '/a/index.json'")
  })
})

describe('fsEntryOf 路径形状判据', () => {
  it('解析 <root>/<dir>/SKILL.md', () => {
    expect(fsEntryOf({ name: 'ponytail', path: '/ws/.dsh/skills/ponytail/SKILL.md' })).toEqual({
      entry: '/ws/.dsh/skills/ponytail',
      root: '/ws/.dsh/skills',
    })
  })

  it('解析 <root>/<name>.md 平铺技能', () => {
    expect(fsEntryOf({ name: 'research', path: '/ws/.dsh/skills/research.md' })).toEqual({
      entry: '/ws/.dsh/skills/research.md',
      root: '/ws/.dsh/skills',
    })
  })

  it('接受目录名与技能名不一致的 bundle', () => {
    expect(fsEntryOf({ name: 'book-to-skill', path: '/ws/skills/book-to-skill-master/SKILL.md' })).toEqual({
      entry: '/ws/skills/book-to-skill-master',
      root: '/ws/skills',
    })
  })

  it('拒绝与技能名不同的平铺 .md（避免误移无关文件）', () => {
    expect(fsEntryOf({ name: 'alpha', path: '/ws/skills/beta.md' })).toBeUndefined()
  })

  // root 会喂给 trashDirOf 与 rm -rf，entry 会作为 mv 的源，所以相对路径必须拒。
  it('拒绝相对路径（否则 root 会退化成 `..`）', () => {
    expect(fsEntryOf({ name: 'alpha', path: 'SKILL.md' })).toBeUndefined()
    expect(fsEntryOf({ name: 'alpha', path: 'skills/alpha/SKILL.md' })).toBeUndefined()
  })
})
