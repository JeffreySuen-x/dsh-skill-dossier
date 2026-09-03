import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWithin, moveNoClobberCommand } from '../src/files.ts'
import { realpathWithin } from '../src/index.ts'

describe('isWithin (lexical path guard)', () => {
  const trash = '/root/.dsh/skill-manager/trash'

  it('accepts a direct child of the trash dir', () => {
    expect(isWithin(`${trash}/skill-1`, trash)).toBe(true)
  })

  it('accepts the trash dir itself', () => {
    expect(isWithin(trash, trash)).toBe(true)
  })

  it('rejects `..` traversal out of the trash dir', () => {
    expect(isWithin(`${trash}/../../../etc/passwd`, trash)).toBe(false)
  })

  it('rejects a sibling whose name shares the prefix', () => {
    expect(isWithin('/root/.dsh/skill-manager/trash-evil/x', trash)).toBe(false)
  })
})

describe('POSIX lifecycle move', () => {
  it.skipIf(process.platform === 'win32')('moves when the destination is absent', () => {
    const base = mkdtempSync(join(tmpdir(), 'sm-move-'))
    try {
      const source = join(base, 'source')
      const destination = join(base, 'destination')
      writeFileSync(source, 'source')

      const result = spawnSync('/bin/sh', ['-c', moveNoClobberCommand(source, destination, false)])

      expect(result.status).toBe(0)
      expect(existsSync(source)).toBe(false)
      expect(readFileSync(destination, 'utf8')).toBe('source')
    } finally { rmSync(base, { recursive: true, force: true }) }
  })

  it.skipIf(process.platform === 'win32')('fails without overwriting when the destination exists', () => {
    const base = mkdtempSync(join(tmpdir(), 'sm-move-'))
    try {
      const source = join(base, 'source')
      const destination = join(base, 'destination')
      writeFileSync(source, 'source')
      writeFileSync(destination, 'destination')

      const result = spawnSync('/bin/sh', ['-c', moveNoClobberCommand(source, destination, false)])

      expect(result.status).not.toBe(0)
      expect(readFileSync(source, 'utf8')).toBe('source')
      expect(readFileSync(destination, 'utf8')).toBe('destination')
    } finally { rmSync(base, { recursive: true, force: true }) }
  })
})

describe('realpathWithin (symlink-aware path guard)', () => {
  let base: string
  let trash: string
  let outside: string

  function setup() {
    base = mkdtempSync(join(tmpdir(), 'sm-test-'))
    trash = join(base, 'trash')
    outside = join(base, 'outside')
    mkdirSync(trash, { recursive: true })
    mkdirSync(outside, { recursive: true })
  }
  function teardown() { rmSync(base, { recursive: true, force: true }) }

  it('accepts a real child of the trash dir', async () => {
    setup()
    try {
      writeFileSync(join(trash, 'skill-1'), 'x')
      expect(await realpathWithin(join(trash, 'skill-1'), trash)).toBe(true)
    } finally { teardown() }
  })

  it('rejects a symlink escaping the trash dir', async () => {
    setup()
    try {
      writeFileSync(join(outside, 'victim.txt'), 'x')
      symlinkSync(outside, join(trash, 'link'))
      expect(await realpathWithin(join(trash, 'link', 'victim.txt'), trash)).toBe(false)
    } finally { teardown() }
  })

  it('returns null for a missing path', async () => {
    setup()
    try {
      expect(await realpathWithin(join(trash, 'gone'), trash)).toBe(null)
    } finally { teardown() }
  })

  it('rejects when the base dir does not exist (tampered root)', async () => {
    setup()
    try {
      expect(await realpathWithin(join(trash, 'x'), join(base, 'no-such-dir'))).toBe(false)
    } finally { teardown() }
  })
})
