import * as win32 from 'node:path/win32'
import { describe, expect, it } from 'vitest'
import { atomicReplaceCommand, fsEntryOf, isWithin, mkdirCommand, moveNoClobberCommand, quoteShellArg, removeRecursiveCommand, trashDirOf } from '../src/files.ts'

describe('Windows 路径解析（path.win32）', () => {
  it('fsEntryOf 解析反斜杠 SKILL.md 路径', () => {
    expect(fsEntryOf({ name: 'ponytail', path: 'C:\\Users\\demo\\.dsh\\skills\\ponytail\\SKILL.md' }, win32)).toEqual({
      entry: 'C:\\Users\\demo\\.dsh\\skills\\ponytail',
      root: 'C:\\Users\\demo\\.dsh\\skills',
    })
  })

  it('fsEntryOf 解析单文件 .md 技能', () => {
    expect(fsEntryOf({ name: 'research', path: 'C:\\Users\\demo\\.dsh\\skills\\research.md' }, win32)).toEqual({
      entry: 'C:\\Users\\demo\\.dsh\\skills\\research.md',
      root: 'C:\\Users\\demo\\.dsh\\skills',
    })
  })

  it('trashDirOf 生成与技能根同级的 trash 目录', () => {
    expect(trashDirOf('C:\\Users\\demo\\.dsh\\skills', win32)).toBe('C:\\Users\\demo\\.dsh\\skill-manager\\trash')
  })

  it('isWithin 接受子路径、拒绝 `..` 穿越', () => {
    const trash = 'C:\\Users\\demo\\.dsh\\skill-manager\\trash'
    expect(isWithin('C:\\Users\\demo\\.dsh\\skill-manager\\trash\\skill-1', trash, win32)).toBe(true)
    expect(isWithin('C:\\Users\\demo\\.dsh\\skill-manager\\trash\\..\\..\\..\\Windows\\system32', trash, win32)).toBe(false)
  })

  it('isWithin 兼容正斜杠路径（win32 会归一化）', () => {
    const trash = 'C:/Users/demo/.dsh/skill-manager/trash'
    expect(isWithin('C:/Users/demo/.dsh/skill-manager/trash/x', trash, win32)).toBe(true)
  })

  it('isWithin 拒绝跨盘路径', () => {
    expect(isWithin('D:\\evil\\x', 'C:\\Users\\demo\\.dsh', win32)).toBe(false)
  })
})

describe('pwsh 命令生成（isWindows=true）', () => {
  it('单引号转义：普通路径原样、内嵌单引号翻倍', () => {
    expect(quoteShellArg('C:\\a b', true)).toBe("'C:\\a b'")
    expect(quoteShellArg("it's", true)).toBe("'it''s'")
  })

  it('mkdir 用 New-Item', () => {
    expect(mkdirCommand('C:\\a b', true)).toBe("New-Item -ItemType Directory -Force -Path 'C:\\a b' | Out-Null")
  })

  it('move 用 Move-Item（无覆盖）', () => {
    expect(moveNoClobberCommand('C:\\src', 'C:\\dst', true)).toBe("Move-Item -Path 'C:\\src' -Destination 'C:\\dst'")
  })

  it('remove 用 Remove-Item', () => {
    expect(removeRecursiveCommand('C:\\x', true)).toBe("Remove-Item -Recurse -Force -Path 'C:\\x'")
  })

  it('原子替换用 .NET 字面路径重载', () => {
    expect(atomicReplaceCommand('C:\\a[b]\\temp', 'C:\\a[b]\\index.json', true)).toBe(
      "[System.IO.File]::Move('C:\\a[b]\\temp', 'C:\\a[b]\\index.json', $true)",
    )
  })
})

describe('bash 命令生成（isWindows=false 回归）', () => {
  it('仍输出 POSIX 命令', () => {
    expect(mkdirCommand('/a b', false)).toBe("mkdir -p '/a b'")
    expect(moveNoClobberCommand('/s', '/d', false)).toBe("mv -n '/s' '/d'")
    expect(removeRecursiveCommand('/x', false)).toBe("rm -rf -- '/x'")
    expect(atomicReplaceCommand('/a/temp', '/a/index.json', false)).toBe("mv -f -- '/a/temp' '/a/index.json'")
  })
})
