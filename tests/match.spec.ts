import { describe, expect, it } from 'vitest'
import { formatMatches, matchSkills, scoreSkill, type SkillProfile } from '../src/match.ts'

function profile(name: string, direction: string, useScope: string, scenarios = ''): SkillProfile {
  return { name, direction, useScope, scenarios }
}

describe('scoreSkill', () => {
  it('boosts a skill whose direction matches the query keywords over an unrelated one', () => {
    const coding = profile('coding-qa', '开发工程', '编码任务质量闸门')
    const content = profile('aeon-content', '内容创作', '视频脚本')
    const result = scoreSkill('帮我写代码并做代码审查', coding)
    expect(result.score).toBeGreaterThan(scoreSkill('帮我写代码并做代码审查', content).score)
  })

  it('prefers a research skill over a frontend skill for a 调研 query', () => {
    const research = profile('research', '研究分析', '调研问题并抓取一手来源')
    const frontend = profile('design-taste-frontend', '前端视觉', '落地页设计')
    expect(scoreSkill('帮我调研这个行业的最新情况', research).score)
      .toBeGreaterThan(scoreSkill('帮我调研这个行业的最新情况', frontend).score)
  })

  it('bonuses a skill-name token present in the query', () => {
    const result = scoreSkill('帮我 review 一下代码', profile('code-review', '开发工程', '审查变更'))
    expect(result.matched).toContain('方向:开发工程')
  })
})

describe('matchSkills', () => {
  it('returns top-K sorted by score and honours the direction filter', () => {
    const profiles = [
      profile('research', '研究分析', '调研问题'),
      profile('china-industry-research', '研究分析', '行业深度调研报告'),
      profile('ponytail', '开发工程', '写代码最简实现'),
    ]
    const all = matchSkills('做一份行业调研报告', profiles, { topK: 10 })
    expect(all[0]?.name).toBe('china-industry-research')
    const onlyEngineering = matchSkills('做一份行业调研报告', profiles, { topK: 10, direction: '开发工程' })
    expect(onlyEngineering.map((m) => m.name)).toEqual(['ponytail'])
  })

  it('truncates long profile fields in the result', () => {
    const long = '很'.repeat(300)
    const [match] = matchSkills('任意', [profile('x', '开发工程', long)], { topK: 1 })
    expect(match?.useScope.length).toBeLessThanOrEqual(161)
  })
})

describe('formatMatches', () => {
  it('reports an empty result explicitly', () => {
    expect(formatMatches([], 3, '任意任务')).toContain('没有')
  })

  it('lists matches one per line with direction and score', () => {
    const text = formatMatches(
      [scoreSkill('写代码', profile('ponytail', '开发工程', '最简实现'))],
      1,
      '写代码',
    )
    expect(text).toContain('ponytail')
    expect(text).toContain('开发工程')
    expect(text).toContain('相关度')
  })
})
