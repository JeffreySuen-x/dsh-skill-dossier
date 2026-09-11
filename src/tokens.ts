/**
 * 目录成本估算：技能目录（name + description）会整段进系统提示，技能越多越挤
 * 上下文。这里给一个零依赖的近似值，用于在档案页回答「谁最占地方」。
 *
 * 口径是近似，不是分词器：CJK 按约 1 token/字，其余按约 4 字符/token（cl100k
 * 量级）。绝对值会有偏差，但排序与量级足够用；UI 一律以「≈」呈现。
 */

/** 估算一段文本的 token 数（近似值，向上取整）。 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const char of String(text ?? '')) {
    if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char)) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

/** 估算一个技能在系统提示里的目录成本。 */
export function estimateSkillTokens(name: string, description: string, whenToUse = ''): number {
  return estimateTokens(`${name} ${description} ${whenToUse}`.trim())
}
