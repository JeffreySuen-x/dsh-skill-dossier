/**
 * 技能方向分类的单一事实源：canonical 10 类 + 每类元数据（描述/示例/
 * 易变性/分类关键词）。host 与 client 都从这里 import，避免两处硬编码漂移。
 *
 * 「方向」是「先分类再检索」的第一段：先用关键词命中判方向（粗、容易），
 * 再在方向内检索（细、候选少）。易变性（volatility）供保鲜复审排优先级。
 */

/** 一个方向分类的完整元数据。 */
export interface Direction {
  /** 中文方向名（也是归档 direction 字段的唯一合法取值）。 */
  label: string
  /** 一句话说明该方向覆盖什么。 */
  description: string
  /** 代表性技能名（给模型/UI 做示例）。 */
  examples: string[]
  /** 领域易变性：high = 内容易过时，复审优先级高。 */
  volatility: 'high' | 'low'
  /** 分类关键词：命中则给该方向投票。 */
  keywords: string[]
}

/** canonical 10 类（顺序即 UI 展示顺序）。 */
export const DIRECTIONS: readonly Direction[] = [
  {
    label: '工程代码',
    description: '写代码、审查、测试、调试、架构与工程化',
    examples: ['ponytail', 'coding-qa', 'tdd', 'code-review'],
    volatility: 'high',
    keywords: ['代码', '编程', '编码', '写码', 'bug', '调试', '接口', '模块', '实现', '重构', '测试', '架构', '选型', 'review', '工单', 'ticket', 'tdd', 'codebase', '类型', '依赖', '函数', '数据库'],
  },
  {
    label: '前端视觉',
    description: 'UI、设计、落地页、产品界面、图转码与图生成',
    examples: ['design-taste-frontend', 'impeccable', 'imagegen-frontend-web'],
    volatility: 'high',
    keywords: ['前端', '页面', 'ui', 'ux', '设计', '视觉', 'landing', '官网', '网页', '样式', 'css', '动效', '仪表盘', 'dashboard', '组件', '品牌', '布局', '响应式', '图标', '配色', '落地页', '海报'],
  },
  {
    label: '调研报告',
    description: '研究、行业/城市报告、数据采集与核实',
    examples: ['research', 'china-industry-research', 'city-20y-development-research'],
    volatility: 'high',
    keywords: ['调研', '研究', '分析', '报告', '行业', '城市', '数据', '方案', '情报', '论文', '深度', '前景', '采集', '核实', '检索', '竞品', '取证'],
  },
  {
    label: '内容写作',
    description: '文案、脚本、视频、写作与可视化表达',
    examples: ['aeon-content', 'humanizer-zh', 'writing-shape'],
    volatility: 'low',
    keywords: ['写作', '文案', '脚本', '视频', '播客', '文章', '内容', '创作', '剪辑', '稿', '选题', '口播', '去ai味', '转写', '可视化', '图', 'mermaid'],
  },
  {
    label: '知识库',
    description: '笔记、Obsidian vault、wiki、溯源与第二大脑',
    examples: ['ai-first-notes', 'kb-ingest', 'obsidian-markdown'],
    volatility: 'low',
    keywords: ['知识库', '笔记', 'obsidian', 'vault', 'wiki', '溯源', '存档', '第二大脑', '资料', '画布', 'canvas', '数据库视图'],
  },
  {
    label: '记忆会话',
    description: '记忆、会话摘要、复盘与进度接续',
    examples: ['aeon-memory-contract', 'aeon-session-summary', 'aeon-review'],
    volatility: 'low',
    keywords: ['记忆', '复盘', '总结', '摘要', '回顾', '周报', '经验', '偏好', '会话', '进度', '交接', '观察记录'],
  },
  {
    label: '多代理编排',
    description: '子代理、并行分发、工作流、任务拆解与交接',
    examples: ['dispatching-parallel-agents', 'handoff', 'head-start'],
    volatility: 'low',
    keywords: ['子代理', '并行', '工作流', '编排', '交接', '分工', '压测', '拆解', '工单', '子任务', 'handoff', 'dispatch', '并发', '多个任务', 'agent团队'],
  },
  {
    label: '本地模型',
    description: '本地 Ollama 多模态预处理、离线编码与向量化',
    examples: ['local-preprocess', 'local-code-assist'],
    volatility: 'high',
    keywords: ['本地', 'ollama', '离线', 'ocr', '预处理', '截图', 'embedding', '向量', '本地模型', '多模态', '本地跑'],
  },
  {
    label: '元技能',
    description: '技能蒸馏、造/改进/评估 skill、写 agent 文档',
    examples: ['god-skill', 'nuwa-skill', 'darwin-skill'],
    volatility: 'low',
    keywords: ['skill', '技能', '蒸馏', '造skill', '提示词', 'prompt', 'agent文档', '进化', '评估', '造技能'],
  },
  {
    label: '命理玄学',
    description: '八字、奇门、合盘、运势与团队匹配',
    examples: ['bazi-deep-analysis', 'weekly-bazi-fortune', 'team-match'],
    volatility: 'low',
    keywords: ['八字', '奇门', '合盘', '命理', '占卜', '运势', '紫微', '周运', '排盘', '风水', '团队匹配', '大五', '人格'],
  },
]

/** 全部方向名（工具描述与 UI 里用）。 */
export const DIRECTION_LABELS: readonly string[] = DIRECTIONS.map((d) => d.label)

/** 判断一个字符串是否为合法方向名。 */
export function isDirectionLabel(label: string): boolean {
  return DIRECTIONS.some((d) => d.label === label)
}

/** 用关键词表给 query 命中的方向投票（先分类的第一步，可命中多个）。 */
export function detectDirections(query: string): string[] {
  const q = query.toLowerCase()
  const hits: string[] = []
  for (const d of DIRECTIONS) {
    if (d.keywords.some((k) => q.includes(k.toLowerCase()))) hits.push(d.label)
  }
  return hits
}
