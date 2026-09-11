import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 已提交文件里不得出现本机绝对路径。
 *
 * 背景：`lib/client.js` 曾经把 CSS module identity 编译成 checkout 的绝对路径，
 * 于是 bundle 里带上了工作区根目录（详见 `.coding-qa/ledger/20260903-4.md`）。
 * 当时只修了那一处，`tests/build-reproducibility.spec.ts` 也只断言那一处——
 * 任何**新增**产物（新的 css 入口、换打包器、`.map`、生成的 `.d.ts`）都不在它
 * 的保护范围内。这里把闸门放宽到「全部已提交文件」，让同类泄漏在提交时就红。
 *
 * 已知无害、因此被排除的两类：
 * - 本文件自身：它必须包含这些模式才能检测它们；
 * - `tests/windows.spec.ts`：`C:\Users\demo\...` 是跨平台路径解析的假夹具。
 * `pnpm-lock.yaml` 的 `sha512-` 依赖完整性哈希与 `lib/*.map` 的 `sourcesContent`
 * 都不匹配下列模式，无需排除。
 */
const PATTERNS: Array<[string, RegExp]> = [
  ['macOS/Linux 用户目录', /\/Users\/[^/\s"']/],
  ['Linux 家目录', /\/home\/[^/\s"']/],
  ['macOS 库目录或自定义根', /\/Library\/[^/\s"']/],
  ['macOS 临时目录', /\/private\/(?:var|tmp)\//],
  ['Windows 用户目录', /[A-Za-z]:[\\/]Users[\\/]/i],
]

const SELF = 'tests/no-local-paths.spec.ts'
const ALLOWED = new Set([SELF, 'tests/windows.spec.ts'])

describe('committed files', () => {
  it('do not embed this machine\u2019s absolute paths', () => {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
    const tracked = execFileSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' })
      .split('\n')
      .filter((name) => name !== '' && !ALLOWED.has(name))

    const violations: string[] = []
    for (const name of tracked) {
      const text = readFileSync(join(repositoryRoot, name), 'utf8')
      for (const [label, pattern] of PATTERNS) {
        const found = pattern.exec(text)
        if (found === null) continue
        const line = text.slice(0, found.index).split('\n').length
        violations.push(`${name}:${line} [${label}] ${found[0]}`)
      }
    }

    expect(violations).toEqual([])
  })
})
