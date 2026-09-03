import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('GitHub Actions contract', () => {
  it('runs all gates on macOS, Linux, and Windows for supported Node versions', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

    expect(workflow).toContain('ubuntu-latest')
    expect(workflow).toContain('macos-latest')
    expect(workflow).toContain('windows-latest')
    expect(workflow).toMatch(/node:\s*\[22, 24\]/)
    expect(workflow).toContain('actions/checkout@v6')
    expect(workflow).toContain('pnpm/setup@v2')
    expect(workflow).toContain('actions/setup-node@v6')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('node qa/gates.mjs')
    expect(workflow).toContain('pnpm run test:windows-smoke')
    expect(workflow).toContain("runner.os == 'Windows'")
    expect(workflow).toContain('git diff --exit-code -- lib')
  })
})
