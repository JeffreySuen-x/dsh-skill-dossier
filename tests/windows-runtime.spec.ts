import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { moveNoClobberCommand } from '../src/files.ts'

function runPowerShell(command: string): SpawnSyncReturns<string> {
  return spawnSync(
    'pwsh.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8' },
  )
}

function expectSuccess(result: SpawnSyncReturns<string>): void {
  if (result.status !== 0) {
    throw new Error(`pwsh failed (${String(result.status)}): ${result.stderr.trim()}`)
  }
}

describe.runIf(process.platform === 'win32')('Windows lifecycle runtime', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'dsh-skill-manager-[runtime]-'))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('moves a special-character directory forward and back', () => {
    const source = join(base, 'skill[a]')
    const destination = join(base, 'trash[b]')
    mkdirSync(source)
    writeFileSync(join(source, 'SKILL.md'), '# alpha')

    expectSuccess(runPowerShell(moveNoClobberCommand(source, destination, true)))
    expect(existsSync(source)).toBe(false)
    expect(readFileSync(join(destination, 'SKILL.md'), 'utf8')).toBe('# alpha')

    expectSuccess(runPowerShell(moveNoClobberCommand(destination, source, true)))
    expect(existsSync(destination)).toBe(false)
    expect(readFileSync(join(source, 'SKILL.md'), 'utf8')).toBe('# alpha')
  })

  it('renames a read-only single-file skill without copy-delete cleanup', () => {
    const source = join(base, 'alpha[read-only].md')
    const destination = join(base, 'alpha[trash].md')
    writeFileSync(source, '# alpha')
    expectSuccess(spawnSync('attrib.exe', ['+R', source], { encoding: 'utf8' }))
    try {
      expectSuccess(runPowerShell(moveNoClobberCommand(source, destination, true)))
      expect(existsSync(source)).toBe(false)
      expect(readFileSync(destination, 'utf8')).toBe('# alpha')
      expectSuccess(runPowerShell(moveNoClobberCommand(destination, source, true)))
      expect(existsSync(destination)).toBe(false)
      expect(readFileSync(source, 'utf8')).toBe('# alpha')
    } finally {
      const remaining = existsSync(source) ? source : destination
      if (existsSync(remaining)) spawnSync('attrib.exe', ['-R', remaining], { encoding: 'utf8' })
    }
  })

  it('fails on a target collision and preserves both files', () => {
    const source = join(base, 'source[1].md')
    const destination = join(base, 'destination[1].md')
    writeFileSync(source, 'source')
    writeFileSync(destination, 'destination')

    const result = runPowerShell(moveNoClobberCommand(source, destination, true))

    expect(result.status).not.toBe(0)
    expect(readFileSync(source, 'utf8')).toBe('source')
    expect(readFileSync(destination, 'utf8')).toBe('destination')
  })

  it('fails when the source is missing', () => {
    const source = join(base, 'missing[1].md')
    const destination = join(base, 'destination[1].md')

    const result = runPowerShell(moveNoClobberCommand(source, destination, true))

    expect(result.status).not.toBe(0)
    expect(existsSync(destination)).toBe(false)
  })

  it('can reuse the native type in one PowerShell process', () => {
    const source = join(base, 'source[type].md')
    const destination = join(base, 'destination[type].md')
    writeFileSync(source, 'source')
    const command = `${moveNoClobberCommand(source, destination, true)}; ${moveNoClobberCommand(destination, source, true)}`

    expectSuccess(runPowerShell(command))

    expect(readFileSync(source, 'utf8')).toBe('source')
    expect(existsSync(destination)).toBe(false)
  })

  it('rejects a cross-volume file move when a second writable volume is available', () => {
    const temporaryRoot = parse(base).root.toLowerCase()
    const workspaceRoot = parse(process.cwd()).root.toLowerCase()
    if (temporaryRoot === workspaceRoot) return

    const workspaceTemp = mkdtempSync(join(process.cwd(), '.dsh-skill-manager-volume-'))
    try {
      const source = join(base, 'source[volume].md')
      const destination = join(workspaceTemp, 'destination[volume].md')
      writeFileSync(source, 'source')

      const result = runPowerShell(moveNoClobberCommand(source, destination, true))

      expect(result.status).not.toBe(0)
      expect(readFileSync(source, 'utf8')).toBe('source')
      expect(existsSync(destination)).toBe(false)
    } finally {
      rmSync(workspaceTemp, { recursive: true, force: true })
    }
  })
})
