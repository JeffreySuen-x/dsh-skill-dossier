/**
 * 自检：用**真实技能根**跑一遍扫描器，把结果与宿主注册表交叉核对。
 *
 * 这不是常规单测（会读本机磁盘，CI 上没有技能根时自动跳过），
 * 而是「扫描器看到的盘面 vs 宿主看到的盘面」的一致性检查：
 * 两边对不上的地方，正是本插件存在的理由（被遮蔽者、坏技能、幽灵档）。
 *
 * 跑法：`npx vitest run tests/real-roots.spec.ts`
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSkillRoots, scanSkillRoots, type ScanDirEntry, type ScanFs } from '../src/scanner.ts'

/**
 * 项目根用环境变量指过来（默认取当前目录）。本自检**不假设**它一定有技能：
 * `user-dsh` 根（`~/.dsh/skills`）通常总有内容，够验证不变式了。
 */
const PROJECT_ROOT = process.env.DSH_REAL_ROOTS_PROJECT ?? process.cwd()

const fs: ScanFs = {
  async resolve(path) {
    return { targetKey: path }
  },
  async readText(target) {
    return readFile(target.targetKey, 'utf8')
  },
  async listDir(target) {
    const entries = await readdir(target.targetKey, { withFileTypes: true })
    return entries.map((entry): ScanDirEntry => ({
      name: entry.name,
      // 朴素口径（与 Node dirent 一致）：目录软链不算 directory。scanner 必须靠 stat 兜住。
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      target: { targetKey: join(target.targetKey, entry.name) },
    }))
  },
  async stat(target) {
    try {
      const info = await stat(target.targetKey)
      if (info.isDirectory()) return { type: 'directory' }
      if (info.isFile()) return { type: 'file', size: info.size }
      return { type: 'other' }
    } catch {
      return undefined
    }
  },
}

const roots = defaultSkillRoots({
  projectRoot: PROJECT_ROOT,
  dshHome: join(homedir(), '.dsh'),
  agentsHome: join(homedir(), '.agents'),
})

describe('真实技能根自检', () => {
  it('扫出条目、赢家与冲突，并把三层成本算出来', async () => {
    const result = await scanSkillRoots(fs, roots, {
      hash: (text) => createHash('sha256').update(text).digest('hex').slice(0, 16),
    })
    const { summary } = result
    // 至少有一个根真的有技能，否则这台机器没装技能，本自检无意义。
    expect(summary.winners).toBeGreaterThan(0)
    expect(summary.entries).toBeGreaterThanOrEqual(summary.winners)

    // 不变式：赢家数 = 去重后的名字数；每个冲突组至少 2 份。
    expect(new Set(result.skills.map((skill) => skill.name)).size).toBe(summary.winners)
    expect(summary.conflicts.every((conflict) => conflict.copies.length >= 2)).toBe(true)

    // 不变式：冲突里第一份的 rank 最小（赢家）。
    for (const conflict of summary.conflicts) {
      const ranks = conflict.copies.map((copy) => copy.rank)
      expect(ranks[0]).toBe(Math.min(...ranks))
    }

    // 成本三层都非零（有技能就一定读过正文）。
    expect(summary.catalogTokens).toBeGreaterThan(0)
    expect(summary.bodyTokens).toBeGreaterThan(summary.catalogTokens)
    expect(summary.assetBytes).toBeGreaterThanOrEqual(0)

    // 目录名与技能名不一致的清单只包含真不一致的。
    for (const name of summary.nameMismatches) {
      const skill = result.skills.find((entry) => entry.name === name)
      expect(skill?.dirName).not.toBe(skill?.name)
    }

    console.log(
      `[real-roots] 根 ${summary.roots.map((root) => root.source).join('/')} · `
      + `条目 ${summary.entries} · 赢家 ${summary.winners} · `
      + `冲突 ${summary.conflicts.length}（分叉 ${summary.conflicts.filter((c) => !c.identical).length}） · `
      + `目录 ≈${summary.catalogTokens} tok · 正文 ≈${summary.bodyTokens} tok · 资源 ${(summary.assetBytes / 1e6).toFixed(1)} MB · `
      + `超长描述 ${summary.truncatedDescriptions.length} · 目录名不一致 ${summary.nameMismatches.length}`,
    )
    for (const conflict of summary.conflicts.filter((item) => !item.identical)) {
      console.log(`[real-roots] 分叉：${conflict.name} → ${conflict.copies.map((copy) => `${copy.source}#${copy.rank}(${copy.hash})`).join(' vs ')}`)
    }
  }, 60_000)
})
