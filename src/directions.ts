/**
 * 技能方向分类的单一事实源：canonical 10 类 + 每类的易变性。host 与 client
 * 都从这里 import，避免两处硬编码漂移。
 *
 * 「方向」是档案的分类轴，也是保鲜复审的输入之一：易变方向（volatility=high）
 * 的内容更容易过时，复审优先级更高。检索不在这里——DSH 把技能目录
 * （name + description）直接放进系统提示，由模型自己选，本插件不再做词法路由。
 */

/** 一个方向分类的元数据。 */
export interface Direction {
  /** 中文方向名（也是归档 direction 字段的唯一合法取值）。 */
  label: string
  /** 一句话说明该方向覆盖什么（UI 上作为标签提示）。 */
  description: string
  /** 领域易变性：high = 内容易过时，复审优先级高。 */
  volatility: 'high' | 'low'
}

/** canonical 10 类（顺序即 UI 展示顺序）。 */
export const DIRECTIONS: readonly Direction[] = [
  { label: '工程代码', description: '写代码、审查、测试、调试、架构与工程化', volatility: 'high' },
  { label: '前端视觉', description: 'UI、设计、落地页、产品界面、图转码与图生成', volatility: 'high' },
  { label: '调研报告', description: '研究、行业/城市报告、数据采集与核实', volatility: 'high' },
  { label: '内容写作', description: '文案、脚本、视频、写作与可视化表达', volatility: 'low' },
  { label: '知识库', description: '笔记、Obsidian vault、wiki、溯源与第二大脑', volatility: 'low' },
  { label: '记忆会话', description: '记忆、会话摘要、复盘与进度接续', volatility: 'low' },
  { label: '多代理编排', description: '子代理、并行分发、工作流、任务拆解与交接', volatility: 'low' },
  { label: '本地模型', description: '本地 Ollama 多模态预处理、离线编码与向量化', volatility: 'high' },
  { label: '元技能', description: '技能蒸馏、造/改进/评估 skill、写 agent 文档', volatility: 'low' },
  { label: '命理玄学', description: '八字、奇门、合盘、运势与团队匹配', volatility: 'low' },
]

/** 全部方向名（工具描述与 UI 里用）。 */
export const DIRECTION_LABELS: readonly string[] = DIRECTIONS.map((d) => d.label)

/** 判断一个字符串是否为合法方向名。 */
export function isDirectionLabel(label: string): boolean {
  return DIRECTIONS.some((d) => d.label === label)
}

/** 方向名 → 一句话说明（UI 标签提示）。 */
export const DIRECTION_HINTS: Readonly<Record<string, string>> = Object.fromEntries(
  DIRECTIONS.map((d) => [d.label, d.description]),
)
