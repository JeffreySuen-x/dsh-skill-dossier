import { describe, expect, it } from 'vitest'
import { estimateSkillTokens, estimateTokens } from '../src/tokens.ts'

describe('estimateTokens', () => {
  it('counts CJK per character and latin per four characters', () => {
    expect(estimateTokens('中文四个字')).toBe(5)
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('')).toBe(0)
  })

  it('never returns a negative or fractional value', () => {
    for (const sample of ['a', '中', 'mixed 混排 text', '\n\t']) {
      const value = estimateTokens(sample)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('estimateSkillTokens', () => {
  it('grows with the description and stays ordered', () => {
    const small = estimateSkillTokens('a', 'short')
    const large = estimateSkillTokens('a', '这是一段明显更长的中文描述，用来验证成本估算随文本增长')
    expect(large).toBeGreaterThan(small)
  })
})
