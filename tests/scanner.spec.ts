import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_DESCRIPTION_MAX_LENGTH,
  catalogDescription,
  defaultSkillRoots,
  parseFrontmatter,
  scanSkillRoots,
  type ScanDirEntry,
  type ScanFs,
  type SkillRoot,
} from '../src/scanner.ts'

/**
 * 内存文件系统替身：路径 → 内容（文件）或子项名（目录），另有一张软链表。
 *
 * 两个刻意的设计：
 * 1. `listDir` 的 `type` 用 Node `dirent` 的**朴素**口径（目录软链报 other），
 *    用来钉住「类型判定必须走 stat 而不是 listDir.type」——真机上 31 个技能
 *    正是软链进来的，只看 dirent 会全部漏掉。
 * 2. 软链按**逐段**解析（`resolvePath`），因此 `link/SKILL.md` 这种子路径
 *    也能穿透软链，与真实 fs 的语义一致。
 */
function memoryFs(tree: Record<string, string | string[]>, symlinks: Record<string, string> = {}): ScanFs {
  const segmentsOf = (path: string): string[] => path.split('/').filter((part) => part !== '')

  /**
   * 逐段解析软链，返回规范化后的真实路径。
   *
   * 关键：`out` 同时是「已解析前缀」和「待处理队列」——遇到软链时把**目标路径
   * 的段**接在当前位置之后重新排队，而不是把已解析的前缀再追加一遍
   * （那会让路径指数级膨胀：`/ws/.dsh/skills` 曾变成 `/ws/ws/.dsh/ws/ws/.dsh/skills`）。
   */
  const resolvePath = (path: string): string => {
    const queue = segmentsOf(path)
    let out: string[] = []
    let hops = 0
    while (queue.length > 0) {
      const segment = queue.shift()!
      const candidate = `/${[...out, segment].join('/')}`
      const link = symlinks[candidate]
      if (link === undefined) {
        out.push(segment)
        continue
      }
      if (hops >= 16) throw new Error(`ELOOP ${path}`)
      hops += 1
      // 绝对目标重置前缀；相对目标接在当前目录下（真实 fs 的语义）。
      if (link.startsWith('/')) out = []
      queue.unshift(...segmentsOf(link))
    }
    return `/${out.join('/')}`
  }

  const nodeOf = (path: string): string | string[] | undefined => tree[resolvePath(path)]

  const typeOf = (path: string): { type: string; size?: number } | undefined => {
    const node = nodeOf(path)
    if (node === undefined) return undefined
    if (typeof node === 'string') return { type: 'file', size: Buffer.byteLength(node, 'utf8') }
    return { type: 'directory' }
  }

  return {
    async resolve(path: string) {
      return { targetKey: path }
    },
    async readText(target: { targetKey: string }) {
      const node = nodeOf(target.targetKey)
      if (typeof node !== 'string') throw new Error(`ENOENT ${target.targetKey}`)
      return node
    },
    async listDir(target: { targetKey: string }) {
      const node = nodeOf(target.targetKey)
      if (node === undefined) throw new Error(`ENOENT ${target.targetKey}`)
      if (typeof node === 'string') throw new Error(`ENOTDIR ${target.targetKey}`)
      return node.map((name) => {
        const child = `${target.targetKey}/${name}`
        const real = tree[resolvePath(child)]
        return { name, type: Array.isArray(real) ? 'directory' : 'other', target: { targetKey: child } }
      })
    },
    async stat(target: { targetKey: string }) {
      return typeOf(target.targetKey)
    },
  }
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

const skill = (name: string, description: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n${extra}`

const ROOTS: SkillRoot[] = [
  { source: 'project-dsh', rank: 100, path: '/ws/.dsh/skills' },
  { source: 'user-dsh', rank: 400, path: '/home/u/.dsh/skills' },
]

describe('defaultSkillRoots', () => {
  it('按宿主优先级表给出四个根，rank 升序', () => {
    const roots = defaultSkillRoots({ projectRoot: '/ws', dshHome: '/home/u/.dsh', agentsHome: '/home/u/.agents' })
    expect(roots.map((root) => [root.rank, root.source, root.path])).toEqual([
      [100, 'project-dsh', '/ws/.dsh/skills'],
      [200, 'project-agents', '/ws/.agents/skills'],
      [400, 'user-dsh', '/home/u/.dsh/skills'],
      [500, 'user-agents', '/home/u/.agents/skills'],
    ])
  })
})

describe('parseFrontmatter', () => {
  it('取出行内标量并去掉包裹引号', () => {
    expect(parseFrontmatter('---\nname: foo\ndescription: "a: b"\n---\nbody')).toEqual({
      name: 'foo',
      description: 'a: b',
    })
  })

  it('跳过块标量指示符（值不在同一行）', () => {
    expect(parseFrontmatter('---\nname: foo\ndescription: |\n  多行\n  正文\n---\n')).toEqual({ name: 'foo' })
  })

  it('没有 frontmatter 时返回空表而不是抛错', () => {
    expect(parseFrontmatter('# 只是一个标题')).toEqual({})
    expect(parseFrontmatter('---\nname: foo\n')).toEqual({})
  })

  it('剥掉行内注释', () => {
    expect(parseFrontmatter('---\nname: foo # 主技能\n---\n')).toEqual({ name: 'foo' })
  })
})

describe('catalogDescription', () => {
  it('折叠空白', () => {
    expect(catalogDescription('  a\n\n  b  ')).toBe('a b')
  })

  it(`超过 ${CATALOG_DESCRIPTION_MAX_LENGTH} 字符时截断并加省略号（与宿主同规则）`, () => {
    const long = 'x'.repeat(CATALOG_DESCRIPTION_MAX_LENGTH + 50)
    const rendered = catalogDescription(long)
    expect(rendered.length).toBe(CATALOG_DESCRIPTION_MAX_LENGTH)
    expect(rendered.endsWith('...')).toBe(true)
  })
})

describe('scanSkillRoots', () => {
  it('发现 bundle 与平铺两种形态，忽略无关条目与 .md 之外的文件', async () => {
    const fs = memoryFs({
      '/ws/.dsh/skills': ['alpha', 'flat.md', 'notes.txt', '.DS_Store', 'no-skill-md'],
      '/ws/.dsh/skills/alpha': ['SKILL.md'],
      '/ws/.dsh/skills/alpha/SKILL.md': skill('alpha', '第一个'),
      '/ws/.dsh/skills/flat.md': skill('flat', '平铺的'),
      '/ws/.dsh/skills/notes.txt': 'not a skill',
      '/ws/.dsh/skills/.DS_Store': 'junk',
      '/ws/.dsh/skills/no-skill-md': [],
    })
    const result = await scanSkillRoots(fs, [ROOTS[0]!], { hash })
    expect(result.skills.map((s) => s.name).sort()).toEqual(['alpha', 'flat'])
    expect(result.summary.entries).toBe(2)
  })

  it('标记同名副本：rank 小的赢，内容相同的组 identical=true', async () => {
    const body = skill('dup', '同一份')
    const fs = memoryFs({
      '/ws/.dsh/skills': ['dup'],
      '/ws/.dsh/skills/dup': ['SKILL.md'],
      '/ws/.dsh/skills/dup/SKILL.md': body,
      '/home/u/.dsh/skills': ['dup'],
      '/home/u/.dsh/skills/dup': ['SKILL.md'],
      '/home/u/.dsh/skills/dup/SKILL.md': body,
    })
    const result = await scanSkillRoots(fs, ROOTS, { hash })
    expect(result.summary.winners).toBe(1)
    expect(result.summary.conflicts).toHaveLength(1)
    const conflict = result.summary.conflicts[0]!
    expect(conflict.identical).toBe(true)
    expect(conflict.copies.map((copy) => copy.source)).toEqual(['project-dsh', 'user-dsh'])
  })

  it('内容分叉的副本排在同内容副本之前（先看真问题）', async () => {
    const fs = memoryFs({
      '/ws/.dsh/skills': ['same', 'drift'],
      '/ws/.dsh/skills/same': ['SKILL.md'],
      '/ws/.dsh/skills/same/SKILL.md': skill('same', 'x'),
      '/ws/.dsh/skills/drift': ['SKILL.md'],
      '/ws/.dsh/skills/drift/SKILL.md': skill('drift', '项目版'),
      '/home/u/.dsh/skills': ['same', 'drift'],
      '/home/u/.dsh/skills/same': ['SKILL.md'],
      '/home/u/.dsh/skills/same/SKILL.md': skill('same', 'x'),
      '/home/u/.dsh/skills/drift': ['SKILL.md'],
      '/home/u/.dsh/skills/drift/SKILL.md': skill('drift', '用户版改过了'),
    })
    const result = await scanSkillRoots(fs, ROOTS, { hash })
    expect(result.summary.conflicts.map((c) => c.name)).toEqual(['drift', 'same'])
    expect(result.summary.conflicts[0]!.identical).toBe(false)
  })

  it('目录名与技能名不一致时用 frontmatter 的名字，并记录 nameMismatches', async () => {
    const fs = memoryFs({
      '/ws/.dsh/skills': ['book-to-skill-master'],
      '/ws/.dsh/skills/book-to-skill-master': ['SKILL.md'],
      '/ws/.dsh/skills/book-to-skill-master/SKILL.md': skill('book-to-skill', '拆书'),
    })
    const result = await scanSkillRoots(fs, [ROOTS[0]!], { hash })
    expect(result.skills[0]!.name).toBe('book-to-skill')
    expect(result.skills[0]!.dirName).toBe('book-to-skill-master')
    expect(result.summary.nameMismatches).toEqual(['book-to-skill'])
  })

  it('缺失的根与坏条目被跳过，不影响其余技能', async () => {
    const fs = memoryFs({
      '/ws/.dsh/skills': ['broken', 'good'],
      '/ws/.dsh/skills/broken': ['SKILL.md'],
      '/ws/.dsh/skills/good': ['SKILL.md'],
      '/ws/.dsh/skills/good/SKILL.md': skill('good', '好的'),
    })
    const result = await scanSkillRoots(fs, ROOTS, { hash })
    expect(result.skills.map((s) => s.name)).toEqual(['good'])
    expect(result.summary.winners).toBe(1)
  })

  it('缺 name 的 frontmatter 回落目录名（与宿主同规则）', async () => {
    const fs = memoryFs({
      '/ws/.dsh/skills': ['fallback'],
      '/ws/.dsh/skills/fallback': ['SKILL.md'],
      '/ws/.dsh/skills/fallback/SKILL.md': '---\ndescription: 没有 name\n---\nbody',
    })
    const result = await scanSkillRoots(fs, [ROOTS[0]!], { hash })
    expect(result.skills[0]!.name).toBe('fallback')
  })

  it('资源体积只统计赢家，且排除正文自身', async () => {
    const fs = memoryFs({
      '/ws/.dsh/skills': ['pack'],
      '/ws/.dsh/skills/pack': ['SKILL.md', 'references'],
      '/ws/.dsh/skills/pack/SKILL.md': skill('pack', '带资源'),
      '/ws/.dsh/skills/pack/references': ['a.md', 'b.md'],
      '/ws/.dsh/skills/pack/references/a.md': 'aaaa',
      '/ws/.dsh/skills/pack/references/b.md': 'bb',
    })
    const result = await scanSkillRoots(fs, [ROOTS[0]!], { hash })
    const skillEntry = result.skills[0]!
    expect(skillEntry.assetFiles).toBe(2)
    expect(skillEntry.assetBytes).toBe(6)
    expect(skillEntry.bodyBytes).toBeGreaterThan(skillEntry.assetBytes)
  })

  // 回归：本机 31 个技能是以**目录软链**挂进来的（`.dsh/skills/x -> 参考项目/...`）。
  // Node 的 `dirent.isDirectory()` 对软链返回 false（`type` 落到 `other`），
  // 只看 `listDir` 的 type 会把这批技能全部漏掉——必须按 `stat`（跟随软链）判定。
  it('软链进来的 bundle 能被发现，路径记在链接所在处', async () => {
    const fs = memoryFs(
      {
        '/ws/.dsh/skills': ['linked'],
        '/repo/taste-skill-main/skills/linked': ['SKILL.md'],
        '/repo/taste-skill-main/skills/linked/SKILL.md': skill('linked-skill', '软链挂进来的'),
      },
      { '/ws/.dsh/skills/linked': '/repo/taste-skill-main/skills/linked' },
    )
    const result = await scanSkillRoots(fs, [ROOTS[0]!], { hash })
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]!.name).toBe('linked-skill')
    expect(result.skills[0]!.dirName).toBe('linked')
    // 技能根里记的是**链接所在**的路径（人看到的入口），不是它指向的源仓库路径。
    expect(result.skills[0]!.skillPath).toBe('/ws/.dsh/skills/linked/SKILL.md')
  })

  it('统计超长 description（会被宿主静默截断的那批）', async () => {
    const long = 'y'.repeat(CATALOG_DESCRIPTION_MAX_LENGTH + 1)
    const fs = memoryFs({
      '/ws/.dsh/skills': ['long-desc'],
      '/ws/.dsh/skills/long-desc': ['SKILL.md'],
      '/ws/.dsh/skills/long-desc/SKILL.md': skill('long-desc', long),
    })
    const result = await scanSkillRoots(fs, [ROOTS[0]!], { hash })
    expect(result.summary.truncatedDescriptions).toEqual(['long-desc'])
  })

  it('目录成本按宿主口径算（name + 截断后 description），不含 whenToUse', async () => {
    const long = 'z'.repeat(CATALOG_DESCRIPTION_MAX_LENGTH * 2)
    const fs = memoryFs({
      '/ws/.dsh/skills': ['cost'],
      '/ws/.dsh/skills/cost': ['SKILL.md'],
      '/ws/.dsh/skills/cost/SKILL.md': `---\nname: cost\ndescription: ${long}\nwhenToUse: ${'w'.repeat(2000)}\n---\nbody`,
    })
    const result = await scanSkillRoots(fs, [ROOTS[0]!], { hash })
    const entry = result.skills[0]!
    const expected = entry.catalogTokens
    expect(expected).toBeLessThan(1000)
    expect(result.summary.catalogTokens).toBe(expected)
  })
})
