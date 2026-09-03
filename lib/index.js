import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { isAbsolute, join, relative, resolve } from "node:path";
//#region lib/types/directions.js
/**
* 技能方向分类的单一事实源：canonical 10 类 + 每类元数据（描述/示例/
* 易变性/分类关键词）。host 与 client 都从这里 import，避免两处硬编码漂移。
*
* 「方向」是「先分类再检索」的第一段：先用关键词命中判方向（粗、容易），
* 再在方向内检索（细、候选少）。易变性（volatility）供保鲜复审排优先级。
*/
/** canonical 10 类（顺序即 UI 展示顺序）。 */
const DIRECTIONS = [
	{
		label: "工程代码",
		description: "写代码、审查、测试、调试、架构与工程化",
		examples: [
			"ponytail",
			"coding-qa",
			"tdd",
			"code-review"
		],
		volatility: "high",
		keywords: [
			"代码",
			"编程",
			"编码",
			"写码",
			"bug",
			"调试",
			"接口",
			"模块",
			"实现",
			"重构",
			"测试",
			"架构",
			"选型",
			"review",
			"工单",
			"ticket",
			"tdd",
			"codebase",
			"类型",
			"依赖",
			"函数",
			"数据库"
		]
	},
	{
		label: "前端视觉",
		description: "UI、设计、落地页、产品界面、图转码与图生成",
		examples: [
			"design-taste-frontend",
			"impeccable",
			"imagegen-frontend-web"
		],
		volatility: "high",
		keywords: [
			"前端",
			"页面",
			"ui",
			"ux",
			"设计",
			"视觉",
			"landing",
			"官网",
			"网页",
			"样式",
			"css",
			"动效",
			"仪表盘",
			"dashboard",
			"组件",
			"品牌",
			"布局",
			"响应式",
			"图标",
			"配色",
			"落地页",
			"海报"
		]
	},
	{
		label: "调研报告",
		description: "研究、行业/城市报告、数据采集与核实",
		examples: [
			"research",
			"china-industry-research",
			"city-20y-development-research"
		],
		volatility: "high",
		keywords: [
			"调研",
			"研究",
			"分析",
			"报告",
			"行业",
			"城市",
			"数据",
			"方案",
			"情报",
			"论文",
			"深度",
			"前景",
			"采集",
			"核实",
			"检索",
			"竞品",
			"取证"
		]
	},
	{
		label: "内容写作",
		description: "文案、脚本、视频、写作与可视化表达",
		examples: [
			"aeon-content",
			"humanizer-zh",
			"writing-shape"
		],
		volatility: "low",
		keywords: [
			"写作",
			"文案",
			"脚本",
			"视频",
			"播客",
			"文章",
			"内容",
			"创作",
			"剪辑",
			"稿",
			"选题",
			"口播",
			"去ai味",
			"转写",
			"可视化",
			"图",
			"mermaid"
		]
	},
	{
		label: "知识库",
		description: "笔记、Obsidian vault、wiki、溯源与第二大脑",
		examples: [
			"ai-first-notes",
			"kb-ingest",
			"obsidian-markdown"
		],
		volatility: "low",
		keywords: [
			"知识库",
			"笔记",
			"obsidian",
			"vault",
			"wiki",
			"溯源",
			"存档",
			"第二大脑",
			"资料",
			"画布",
			"canvas",
			"数据库视图"
		]
	},
	{
		label: "记忆会话",
		description: "记忆、会话摘要、复盘与进度接续",
		examples: [
			"aeon-memory-contract",
			"aeon-session-summary",
			"aeon-review"
		],
		volatility: "low",
		keywords: [
			"记忆",
			"复盘",
			"总结",
			"摘要",
			"回顾",
			"周报",
			"经验",
			"偏好",
			"会话",
			"进度",
			"交接",
			"观察记录"
		]
	},
	{
		label: "多代理编排",
		description: "子代理、并行分发、工作流、任务拆解与交接",
		examples: [
			"dispatching-parallel-agents",
			"handoff",
			"head-start"
		],
		volatility: "low",
		keywords: [
			"子代理",
			"并行",
			"工作流",
			"编排",
			"交接",
			"分工",
			"压测",
			"拆解",
			"工单",
			"子任务",
			"handoff",
			"dispatch",
			"并发",
			"多个任务",
			"agent团队"
		]
	},
	{
		label: "本地模型",
		description: "本地 Ollama 多模态预处理、离线编码与向量化",
		examples: ["local-preprocess", "local-code-assist"],
		volatility: "high",
		keywords: [
			"本地",
			"ollama",
			"离线",
			"ocr",
			"预处理",
			"截图",
			"embedding",
			"向量",
			"本地模型",
			"多模态",
			"本地跑"
		]
	},
	{
		label: "元技能",
		description: "技能蒸馏、造/改进/评估 skill、写 agent 文档",
		examples: [
			"god-skill",
			"nuwa-skill",
			"darwin-skill"
		],
		volatility: "low",
		keywords: [
			"skill",
			"技能",
			"蒸馏",
			"造skill",
			"提示词",
			"prompt",
			"agent文档",
			"进化",
			"评估",
			"造技能"
		]
	},
	{
		label: "命理玄学",
		description: "八字、奇门、合盘、运势与团队匹配",
		examples: [
			"bazi-deep-analysis",
			"weekly-bazi-fortune",
			"team-match"
		],
		volatility: "low",
		keywords: [
			"八字",
			"奇门",
			"合盘",
			"命理",
			"占卜",
			"运势",
			"紫微",
			"周运",
			"排盘",
			"风水",
			"团队匹配",
			"大五",
			"人格"
		]
	}
];
/** 全部方向名（工具描述与 UI 里用）。 */
const DIRECTION_LABELS = DIRECTIONS.map((d) => d.label);
/** 判断一个字符串是否为合法方向名。 */
function isDirectionLabel(label) {
	return DIRECTIONS.some((d) => d.label === label);
}
/** 用关键词表给 query 命中的方向投票（先分类的第一步，可命中多个）。 */
function detectDirections(query) {
	const q = query.toLowerCase();
	const hits = [];
	for (const d of DIRECTIONS) if (d.keywords.some((k) => q.includes(k.toLowerCase()))) hits.push(d.label);
	return hits;
}
//#endregion
//#region lib/types/match.js
/**
* 技能匹配：给定当前任务的一句话描述，从已建档技能中按确定性评分选出
* 最相关的若干条，把候选收窄到短名单；最终语义判断交给模型。
*
* 评分是朴素的文本启发式：方向关键词命中 + 字符二元组重叠 + 技能名
* 词元命中。它不追求语义精确，只负责「把明显相关的排在前面」。
*/
const TRUNCATE = 160;
function truncate(text, max = TRUNCATE) {
	if (text === void 0 || text === "") return "";
	const t = text.replace(/\s+/g, " ").trim();
	return t.length <= max ? t : `${t.slice(0, max)}…`;
}
function clean(text) {
	return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}
function bigrams(text) {
	const map = /* @__PURE__ */ new Map();
	const t = clean(text);
	for (let i = 0; i + 1 < t.length; i += 1) {
		const g = t.slice(i, i + 2);
		map.set(g, (map.get(g) ?? 0) + 1);
	}
	return map;
}
/** 查询与目标文本的字符二元组重叠率（0..1），中文下近似「共用词块」程度。 */
function overlapScore(query, target) {
	const q = bigrams(query);
	const t = bigrams(target);
	if (q.size === 0) return 0;
	let hits = 0;
	for (const g of q.keys()) if (t.has(g)) hits += 1;
	return hits / q.size;
}
function nameTokens(name) {
	return name.toLowerCase().split("-").filter((t) => t.length >= 2);
}
/**
* 给单条技能档案打分，并附带命中的理由标签。
* @param query 当前任务的一句话描述
* @param profile 建档档案
* @param extraText 额外参与重叠的文本（通常是注册表里的 description/whenToUse）
*/
function scoreSkill(query, profile, extraText = "") {
	const searchText = [
		profile.name,
		profile.direction ?? "",
		profile.useScope ?? "",
		profile.scenarios ?? "",
		profile.notes ?? "",
		extraText
	].join(" ");
	const matched = [];
	let score = 0;
	const directions = detectDirections(query);
	if (profile.direction !== void 0 && profile.direction !== "" && directions.includes(profile.direction)) {
		score += 3;
		matched.push(`方向:${profile.direction}`);
	}
	const overlap = overlapScore(query, searchText);
	if (overlap > 0) {
		score += overlap * 5;
		matched.push(`文本重叠 ${Math.round(overlap * 100)}%`);
	}
	for (const token of nameTokens(profile.name)) if (query.toLowerCase().includes(token)) {
		score += 2;
		matched.push(`名称:${token}`);
		break;
	}
	return {
		name: profile.name,
		direction: profile.direction !== void 0 && profile.direction !== "" ? profile.direction : "未标注",
		useScope: truncate(profile.useScope),
		scenarios: truncate(profile.scenarios),
		score: Math.round(score * 10) / 10,
		matched
	};
}
/**
* 对建档技能排序并取前 topK 条（可选按方向过滤）。
* @param query 当前任务的一句话描述
* @param profiles 建档档案列表
* @param options 匹配选项
* @param extraText 技能名 → 额外文本（注册表描述等），缺省为空
*/
function matchSkills(query, profiles, options, extraText = /* @__PURE__ */ new Map()) {
	return (options.direction === void 0 ? profiles : profiles.filter((p) => p.direction === options.direction)).map((p) => scoreSkill(query, p, extraText.get(p.name) ?? "")).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, options.topK);
}
/**
* 把匹配结果渲染成给模型看的一行一条的紧凑文本。
* @param matches 匹配结果
* @param total 建档技能总数
* @param query 原始任务描述
*/
function formatMatches(matches, total, query) {
	if (matches.length === 0) return `在 ${total} 条已建档技能里没有找到与「${query}」明显相关的候选。可以换更宽的关键词，或用 skill 工具直接加载你已知的某个技能。`;
	const lines = matches.map((m, i) => {
		const tag = m.matched.length > 0 ? ` [${m.matched.join(" · ")}]` : "";
		return `${i + 1}. ${m.name} — ${m.direction}（相关度 ${m.score}）${tag}\n   适用：${m.useScope || "—"}\n   场景：${m.scenarios || "—"}`;
	});
	return `在 ${total} 条已建档技能中，与「${query}」最相关的前 ${matches.length} 条：\n\n${lines.join("\n\n")}\n\n对最匹配的一条调用 skill 工具加载全文后再执行；若无满意结果，可指定 direction 过滤或增大 topK。`;
}
//#endregion
//#region lib/types/freshness.js
/**
* 保鲜信号：从方向易变性 + 使用频率 + 复审时间，算出「哪些技能该复审」的
* 优先级排序。纯函数、无 I/O，便于单测。复审本身（内容是否过时、是否有效）
* 交给 darwin-skill 在对话框外做，这里只负责「发现 + 排序」。
*/
const DAY_MS = 864e5;
const VOLATILITY = new Map(DIRECTIONS.map((d) => [d.label, d.volatility]));
/**
* 计算待复审候选并按优先级降序取前 topK 条。
* @param skills 已建档技能（含 direction / reviewedAt）。
* @param usage 调用统计。
* @param now 当前时间戳（ms）。
* @param topK 返回条数。
*/
function reviewCandidates(skills, usage, now, topK) {
	const entries = [];
	for (const [name, skill] of Object.entries(skills)) {
		const direction = typeof skill.direction === "string" && skill.direction !== "" ? skill.direction : "未标注";
		const volatility = VOLATILITY.get(direction) ?? "low";
		const rec = usage[name];
		const daysSinceUse = rec === void 0 ? null : Math.floor((now - rec.lastUsedAt) / DAY_MS);
		const daysSinceReviewed = skill.reviewedAt === void 0 ? null : Math.floor((now - skill.reviewedAt) / DAY_MS);
		let priority = 0;
		const reasons = [];
		if (volatility === "high") {
			priority += 2;
			reasons.push("易变方向");
		}
		if (daysSinceUse === null) {
			priority += 3;
			reasons.push("从未使用");
		} else if (daysSinceUse > 60) {
			priority += 3;
			reasons.push(`长期未用(${daysSinceUse}天)`);
		} else if (daysSinceUse > 30) {
			priority += 2;
			reasons.push(`较久未用(${daysSinceUse}天)`);
		}
		if (daysSinceReviewed === null) {
			priority += 2;
			reasons.push("从未复审");
		} else if (daysSinceReviewed > 90) {
			priority += 2;
			reasons.push(`久未复审(${daysSinceReviewed}天)`);
		}
		entries.push({
			name,
			direction,
			volatility,
			daysSinceUse,
			daysSinceReviewed,
			reasons,
			priority
		});
	}
	return entries.filter((e) => e.priority > 0).sort((a, b) => b.priority - a.priority || (a.daysSinceUse ?? Number.MAX_SAFE_INTEGER) - (b.daysSinceUse ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name)).slice(0, topK);
}
/**
* 把待复审候选渲染成给模型看的一行一条的紧凑文本。
*/
function formatReview(entries, total) {
	if (entries.length === 0) return `在 ${total} 条技能里没有明显待复审的（无长期未用 / 无易变方向久置）。`;
	const lines = entries.map((e, i) => `${i + 1}. ${e.name} — ${e.direction}（${e.reasons.join("、")}）`);
	return `在 ${total} 条技能里，待复审优先级最高的 ${entries.length} 条：\n\n${lines.join("\n")}\n\n对可疑的一条用 skill_eval 触发 darwin-skill 评测。`;
}
/** 本地时区的 'YYYY-MM-DD' 键。 */
function dayKey(at) {
	const d = new Date(at);
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${month}-${day}`;
}
/**
* 把一次调用折叠进 usage 表（原地修改），返回被更新的记录。
* @param usage 按技能名分组的调用统计（可空表）。
* @param name 技能名（kebab-case）。
* @param at 本次调用时间戳（ms）。
*/
function recordUsage(usage, name, at) {
	const rec = usage[name] ?? {
		count: 0,
		firstUsedAt: at,
		lastUsedAt: at,
		daily: {},
		recent: []
	};
	rec.count += 1;
	rec.lastUsedAt = at;
	const key = dayKey(at);
	rec.daily[key] = (rec.daily[key] ?? 0) + 1;
	rec.recent.push(at);
	if (rec.recent.length > 20) rec.recent.splice(0, rec.recent.length - 20);
	usage[name] = rec;
	return rec;
}
/**
* 把整张 usage 表聚合成按调用次数降序的摘要列表。
* @param usage 按技能名分组的调用统计。
* @param now 当前时间戳（ms），用于计算 lastUsedDaysAgo。
*/
function summarizeUsage(usage, now) {
	return Object.entries(usage).map(([name, rec]) => {
		const activeDays = Object.keys(rec.daily).length;
		const callsPerDay = activeDays === 0 ? rec.count : Math.round(rec.count / activeDays * 10) / 10;
		const lastUsedDaysAgo = Math.max(0, Math.floor((now - rec.lastUsedAt) / 864e5));
		return {
			name,
			count: rec.count,
			firstUsedAt: rec.firstUsedAt,
			lastUsedAt: rec.lastUsedAt,
			activeDays,
			callsPerDay,
			lastUsedDaysAgo
		};
	}).sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name));
}
/**
* 把调用统计渲染成给模型看的一行一条的紧凑文本。
* @param usage 按技能名分组的调用统计。
* @param name 只看某个技能；省略则列出所有被调用过的技能。
* @param now 当前时间戳（ms）。
*/
function formatUsage(usage, name, now) {
	const summaries = summarizeUsage(usage, now);
	if (summaries.length === 0) return "还没有任何技能调用记录。技能被 skill 工具加载、或用户用 /name 手势调用后会自动记录。";
	if (name !== void 0 && name !== "") {
		const summary = summaries.find((s) => s.name === name);
		if (summary === void 0) return `技能 "${name}" 还没有调用记录。`;
		const rec = usage[name];
		const daily = Object.entries(rec.daily).sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => `${d}×${n}`);
		return [
			`技能 "${name}" 共被调用 ${summary.count} 次：`,
			`首次 ${dayKey(summary.firstUsedAt)}，最近 ${dayKey(summary.lastUsedAt)}（${summary.lastUsedDaysAgo} 天前）`,
			`活跃 ${summary.activeDays} 天，平均 ${summary.callsPerDay} 次/天`,
			`每日分布：${daily.join("、")}`
		].join("\n");
	}
	const total = summaries.reduce((acc, s) => acc + s.count, 0);
	const lines = summaries.map((s, i) => `${i + 1}. ${s.name} — ${s.count} 次 · 活跃 ${s.activeDays} 天 · 平均 ${s.callsPerDay} 次/天 · 最近 ${dayKey(s.lastUsedAt)}`);
	return `共 ${summaries.length} 个技能被调用过（总计 ${total} 次）：\n\n${lines.join("\n")}`;
}
/** 用户消息里的 /name 手势：匹配 `/[a-z0-9-]+`，词边界与工具端一致。 */
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;
/**
* 从一段用户文本里提取 /name 手势命中的技能名（去重、保序）。
* @param text 用户输入的纯文本。
*/
function skillGestures(text) {
	const names = [];
	for (const match of text.matchAll(SKILL_GESTURE)) {
		const name = match[2];
		if (name !== void 0 && !names.includes(name)) names.push(name);
	}
	return names;
}
//#endregion
//#region lib/types/files.js
/**
* 纯函数：跨平台路径解析与 shell 命令生成。
*
* 路径操作通过注入的 {@link PathFns}（node:path 的 posix/win32 实现）完成，
* 命令生成按 `isWindows` 分支（bash vs pwsh），使 Windows 行为能在非 Windows
* 机器上直接单测，而无需真机。
*/
/** 默认按运行平台（node:path）。 */
const defaultPath = path;
/** 判断 candidate 词法解析后是否仍在 dir 目录内（解析 `..`，不解析符号链接）。
* `relative` 在跨盘（Windows）时返回目标绝对路径，故用 isAbsolute 一并拦截。 */
function isWithin(candidate, dir, p = defaultPath) {
	const rel = p.relative(p.resolve(dir), p.resolve(candidate));
	return rel === "" || !rel.startsWith("..") && !p.isAbsolute(rel);
}
/** 从注册表定义解析可移动的文件系统条目（只信任注册表给的路径）。 */
function fsEntryOf(skill, p = defaultPath) {
	if (typeof skill.path !== "string") return void 0;
	const base = p.basename(skill.path);
	if (base === "SKILL.md") {
		const dir = p.dirname(skill.path);
		if (p.basename(dir) !== skill.name) return void 0;
		return {
			entry: dir,
			root: p.dirname(dir)
		};
	}
	if (base === `${skill.name}.md`) return {
		entry: skill.path,
		root: p.dirname(skill.path)
	};
}
/** trash 目录：与技能根同级（技能根父目录下的 skill-manager/trash）。 */
function trashDirOf(root, p = defaultPath) {
	return p.join(p.dirname(root), "skill-manager", "trash");
}
/** 把值转成 shell 单引号参数（POSIX 用 '\''，pwsh 用 ''）。 */
function quoteShellArg(value, isWindows) {
	const v = String(value);
	return isWindows ? `'${v.replaceAll("'", "''")}'` : `'${v.replaceAll("'", "'\\''")}'`;
}
function mkdirCommand(dir, isWindows) {
	return isWindows ? `New-Item -ItemType Directory -Force -Path ${quoteShellArg(dir, isWindows)} | Out-Null` : `mkdir -p ${quoteShellArg(dir, isWindows)}`;
}
function moveNoClobberCommand(src, dst, isWindows) {
	return isWindows ? `Move-Item -Path ${quoteShellArg(src, isWindows)} -Destination ${quoteShellArg(dst, isWindows)}` : `mv -n ${quoteShellArg(src, isWindows)} ${quoteShellArg(dst, isWindows)}`;
}
function removeRecursiveCommand(path, isWindows) {
	return isWindows ? `Remove-Item -Recurse -Force -Path ${quoteShellArg(path, isWindows)}` : `rm -rf -- ${quoteShellArg(path, isWindows)}`;
}
/** Replace a file by renaming a same-directory temporary file over it. */
function atomicReplaceCommand(src, dst, isWindows) {
	return isWindows ? `[System.IO.File]::Move(${quoteShellArg(src, true)}, ${quoteShellArg(dst, true)}, $true)` : `mv -f -- ${quoteShellArg(src, false)} ${quoteShellArg(dst, false)}`;
}
/** Remove one staging file without interpreting wildcard characters. */
function removeFileCommand(path, isWindows) {
	return isWindows ? `Remove-Item -Force -LiteralPath ${quoteShellArg(path, true)}` : `rm -f -- ${quoteShellArg(path, false)}`;
}
//#endregion
//#region lib/types/http.js
/** Shared JSON-over-HTTP helpers for the manager and report APIs. */
async function readJsonBody(req, maxBytes) {
	let body = "";
	for await (const chunk of req) {
		body += String(chunk);
		if (body.length > maxBytes) throw new Error("请求体过大");
	}
	return body === "" ? {} : JSON.parse(body);
}
function respondJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(payload));
}
/** Reject browser requests originating from another site. */
function isCrossSiteRequest(req) {
	const site = req.headers?.["sec-fetch-site"];
	if (typeof site === "string" && site === "cross-site") return true;
	const origin = req.headers?.origin;
	if (typeof origin !== "string" || origin === "") return false;
	const host = req.headers?.host;
	if (typeof host !== "string" || host === "") return true;
	try {
		return new URL(origin).host !== host;
	} catch {
		return true;
	}
}
//#endregion
//#region lib/types/index-store.js
function emptyArchiveIndex() {
	return {
		version: 1,
		skills: {},
		trash: {},
		usage: {}
	};
}
function recordField(value, field) {
	if (value === void 0) return {};
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`索引文件损坏：${field} 必须是对象`);
	return value;
}
function parseArchiveIndex(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`索引文件损坏：JSON 无法解析（${message}）`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("索引文件损坏：根结构必须是对象");
	const value = parsed;
	if (value.version !== void 0 && value.version !== 1) throw new Error(`索引文件损坏：不支持版本 ${String(value.version)}`);
	return {
		version: 1,
		skills: recordField(value.skills, "skills"),
		trash: recordField(value.trash, "trash"),
		usage: recordField(value.usage, "usage")
	};
}
function isMissingFile(error) {
	return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
/** A per-workspace serialized read/modify/atomic-write store. */
function createIndexStore(storage) {
	const barriers = /* @__PURE__ */ new Map();
	async function load(cwd) {
		try {
			return parseArchiveIndex(await storage.read(cwd));
		} catch (error) {
			if (isMissingFile(error)) return emptyArchiveIndex();
			throw error;
		}
	}
	function enqueue(cwd, task) {
		const result = (barriers.get(cwd) ?? Promise.resolve()).then(task, task);
		const barrier = result.then(() => void 0, () => void 0);
		barriers.set(cwd, barrier);
		barrier.then(() => {
			if (barriers.get(cwd) === barrier) barriers.delete(cwd);
		});
		return result;
	}
	return {
		async read(cwd) {
			if (cwd === void 0) return emptyArchiveIndex();
			const key = await (storage.lockKey?.(cwd) ?? cwd);
			await (barriers.get(key) ?? Promise.resolve());
			return load(cwd);
		},
		async update(cwd, mutate) {
			return enqueue(await (storage.lockKey?.(cwd) ?? cwd), async () => {
				const index = await load(cwd);
				const result = await mutate(index);
				await storage.writeAtomic(cwd, JSON.stringify(index, null, 2));
				return result;
			});
		}
	};
}
//#endregion
//#region lib/types/report.js
const MAX_BODY_BYTES$1 = 1048576;
const DATA_ROOT = "reporter";
/** Parse the brief skill's stable markdown contract. */
function parseBrief(text) {
	const projects = [];
	const lines = String(text || "").split("\n");
	let current;
	let mode = "";
	for (const line of lines) {
		const heading = line.match(/^##\s+(.+)/);
		if (heading?.[1] !== void 0) {
			if (current !== void 0) projects.push(current);
			current = {
				name: heading[1].trim(),
				purpose: "",
				impl: "",
				progress: [],
				todo: [],
				issues: []
			};
			mode = "";
			continue;
		}
		if (current === void 0) continue;
		const trimmed = line.trim();
		if (trimmed === "") continue;
		let match = trimmed.match(/^[-*]\s*作用[:：]\s*(.*)/);
		if (match?.[1] !== void 0) {
			current.purpose = match[1].trim();
			continue;
		}
		match = trimmed.match(/^[-*]\s*实现[:：]\s*(.*)/);
		if (match?.[1] !== void 0) {
			current.impl = match[1].trim();
			continue;
		}
		if (/^[-*]?\s*今日进度\s*[:：]/.test(trimmed)) {
			mode = "progress";
			continue;
		}
		if (/^[-*]?\s*待办\s*[:：]/.test(trimmed)) {
			mode = "todo";
			continue;
		}
		if (/^[-*]?\s*问题\s*[:：]/.test(trimmed)) {
			mode = "issues";
			continue;
		}
		match = trimmed.match(/^(?:\d+[.、)]|[-*])\s*(.*)/);
		const item = match?.[1]?.trim();
		if (item === void 0) continue;
		if (mode === "progress") current.progress.push(item);
		else if (mode === "todo") current.todo.push(item);
		else if (mode === "issues") current.issues.push(item);
	}
	if (current !== void 0) projects.push(current);
	return projects;
}
function pickDailyDate(allDates, today) {
	if (allDates.includes(today)) return {
		date: today,
		fallbackFrom: ""
	};
	const latest = allDates.at(-1) ?? "";
	return {
		date: latest,
		fallbackFrom: latest === "" ? "" : today
	};
}
function pickMonth(allDates, currentMonth) {
	const inMonth = allDates.filter((date) => date.startsWith(currentMonth));
	if (inMonth.length > 0) return {
		month: currentMonth,
		fallbackMonth: "",
		dates: inMonth
	};
	const latest = allDates.at(-1);
	if (latest === void 0) return {
		month: currentMonth,
		fallbackMonth: "",
		dates: []
	};
	const month = latest.slice(0, 7);
	return {
		month,
		fallbackMonth: month,
		dates: allDates.filter((date) => date.startsWith(month))
	};
}
function toMarkdown(data, view) {
	const lines = [];
	if (view === "monthly") {
		lines.push(`# 月度归纳 ${String(data.month ?? "")}`, "", "## 按日栏式", "");
		lines.push("| 日期 | 项目 | 进度 | 待办 | 问题 |", "|---|---|---|---|---|");
		for (const day of data.days ?? []) lines.push(`| ${tableCell(day.date)} | ${tableCell((day.projects ?? []).join("、"))} | ${tableCell((day.progress ?? []).join("；"))} | ${tableCell((day.todo ?? []).join("；"))} | ${tableCell((day.issues ?? []).join("；"))} |`);
		lines.push("", "## 跨日项目汇总");
		for (const project of data.projects ?? []) {
			lines.push("", `### ${String(project.name ?? "")}`);
			if (project.purpose) lines.push(`- 作用：${String(project.purpose)}`);
			if (project.impl) lines.push(`- 实现：${String(project.impl)}`);
			appendItems(lines, "累计进度", project.progress, "（暂无）");
			appendItems(lines, "待办", project.todo, "（无）");
			appendItems(lines, "问题", project.issues, "（无）");
		}
	} else {
		lines.push(`# 每日简报 ${String(data.date ?? "")}`, "");
		if ((data.projects ?? []).length === 0) lines.push(`（无记录，按 brief skill 维护 reporter/brief/${String(data.date ?? "")}.md）`);
		for (const [index, project] of (data.projects ?? []).entries()) {
			lines.push("", `${index + 1}、${String(project.name ?? "")}`);
			if (project.purpose) lines.push(`  作用：${String(project.purpose)}`);
			if (project.impl) lines.push(`  实现：${String(project.impl)}`);
			appendItems(lines, "今日进度", project.progress, "（暂无）", "  ");
			appendItems(lines, "待办", project.todo, "（无）", "  ");
			appendItems(lines, "问题", project.issues, "（无）", "  ");
		}
	}
	return lines.join("\n");
}
function tableCell(value) {
	return String(value ?? "").replaceAll("|", "&#124;").replace(/\r?\n/g, "<br>");
}
function appendItems(lines, label, values, empty, prefix = "- ") {
	lines.push(`${prefix}${label}：`);
	const items = values ?? [];
	if (items.length === 0) lines.push(`${prefix}${empty}`);
	else items.forEach((item, index) => lines.push(`${prefix}${index + 1}、${item}`));
}
function localDateKey() {
	const date = /* @__PURE__ */ new Date();
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function extractDate(text) {
	return String(text || "").match(/^---\s*\ndate:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
}
function statsOf(projects) {
	return {
		projects: projects.length,
		progress: projects.reduce((sum, project) => sum + project.progress.length, 0),
		todo: projects.reduce((sum, project) => sum + project.todo.length, 0),
		issues: projects.reduce((sum, project) => sum + project.issues.length, 0)
	};
}
/** Register `/api/report` as part of the manager package's host activation. */
function registerReportApi(ctx, deps) {
	const { webServer, agents, fs, sandboxPolicy, ensureDirectories } = deps;
	function cwdOf(sessionId) {
		if (typeof sessionId !== "string") return "";
		return agents.get(sessionId)?.session.header.cwd ?? "";
	}
	function policyOf(sessionId) {
		const agent = typeof sessionId === "string" ? agents.get(sessionId) : void 0;
		return agent === void 0 ? sandboxPolicy.resolve() : sandboxPolicy.resolve({ session: agent.session });
	}
	async function readBrief(cwd, date) {
		const relativePath = `${DATA_ROOT}/brief/${date}.md`;
		const target = await fs.resolve(relativePath, { cwd });
		const text = await fs.readText(target);
		return {
			path: relativePath,
			date: extractDate(text) || date,
			projects: parseBrief(text)
		};
	}
	async function listBriefDates(cwd) {
		const target = await fs.resolve(`${DATA_ROOT}/brief`, { cwd });
		let entries;
		try {
			entries = await fs.listDir(target);
		} catch (error) {
			if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
			throw error;
		}
		return entries.flatMap((entry) => {
			const match = String(entry.name ?? entry.path ?? "").match(/(\d{4}-\d{2}-\d{2})\.md$/);
			return match?.[1] === void 0 ? [] : [match[1]];
		}).sort();
	}
	async function generateDaily(args) {
		const cwd = cwdOf(args?.sessionId);
		const today = localDateKey();
		const emptyStats = {
			projects: 0,
			progress: 0,
			todo: 0,
			issues: 0
		};
		if (cwd === "") return {
			date: today,
			projects: [],
			stats: emptyStats,
			source: `${DATA_ROOT}/brief/`,
			lastError: "无法确定工作区目录"
		};
		try {
			const pick = pickDailyDate(await listBriefDates(cwd), today);
			if (pick.date === "") return {
				date: today,
				projects: [],
				stats: emptyStats,
				source: `${DATA_ROOT}/brief/`,
				lastError: ""
			};
			const result = await readBrief(cwd, pick.date);
			return {
				date: result.date,
				projects: result.projects,
				stats: statsOf(result.projects),
				source: result.path,
				lastError: "",
				fallbackFrom: pick.fallbackFrom
			};
		} catch (error) {
			return {
				date: today,
				projects: [],
				stats: emptyStats,
				source: `${DATA_ROOT}/brief/`,
				lastError: errorMessage(error)
			};
		}
	}
	async function generateMonthly(args) {
		const cwd = cwdOf(args?.sessionId);
		const currentMonth = localDateKey().slice(0, 7);
		if (cwd === "") return {
			month: currentMonth,
			days: [],
			projects: [],
			source: `${DATA_ROOT}/brief/`,
			lastError: "无法确定工作区目录",
			fallbackMonth: ""
		};
		let dates = [];
		try {
			dates = await listBriefDates(cwd);
		} catch (error) {
			return {
				month: currentMonth,
				days: [],
				projects: [],
				source: `${DATA_ROOT}/brief/`,
				lastError: errorMessage(error),
				fallbackMonth: ""
			};
		}
		const pick = pickMonth(dates, currentMonth);
		const days = [];
		const projects = /* @__PURE__ */ new Map();
		const skipped = [];
		for (const date of pick.dates) try {
			const result = await readBrief(cwd, date);
			days.push({
				date,
				projects: result.projects.map((project) => project.name),
				progress: result.projects.flatMap((project) => project.progress),
				todo: result.projects.flatMap((project) => project.todo),
				issues: result.projects.flatMap((project) => project.issues)
			});
			for (const project of result.projects) {
				const aggregate = projects.get(project.name) ?? {
					name: project.name,
					purpose: project.purpose,
					impl: project.impl,
					progress: [],
					todo: [],
					issues: []
				};
				if (aggregate.purpose === "" && project.purpose !== "") aggregate.purpose = project.purpose;
				if (aggregate.impl === "" && project.impl !== "") aggregate.impl = project.impl;
				aggregate.progress.push(...project.progress);
				aggregate.todo.push(...project.todo);
				aggregate.issues.push(...project.issues);
				projects.set(project.name, aggregate);
			}
		} catch {
			skipped.push(date);
		}
		return {
			month: pick.month,
			days,
			projects: [...projects.values()],
			source: `${DATA_ROOT}/brief/`,
			lastError: skipped.length === 0 ? "" : `以下简报读取失败：${skipped.join("、")}`,
			fallbackMonth: pick.fallbackMonth
		};
	}
	async function review(args) {
		const sessionId = args?.sessionId;
		const cwd = cwdOf(sessionId);
		if (cwd === "" || typeof sessionId !== "string") return {
			ok: false,
			error: "无法确定工作区目录"
		};
		const agent = agents.get(sessionId);
		if (agent === void 0) return {
			ok: false,
			error: "找不到对应 agent（会话可能已结束）"
		};
		await ensureDirectories(cwd, sessionId);
		const date = localDateKey();
		const prompt = [
			"【复盘任务】请对 reporter/brief/ 下所有简报做一次整合复盘：",
			"1. 读取 reporter/brief/ 目录下所有 YYYY-MM-DD.md 文件。",
			"2. 按「结构化观察」提炼跨项目的踩坑、决策、可复用知识点（每条带发生日期与来源项目）。",
			"3. 按「周期复盘」聚合：完成了什么、关键收获、下一步、涌现主题、未记录到的成就。",
			`4. 用 markdown 写成复盘文件，保存到 reporter/Review/${date}.md（目录不存在则创建）。`,
			"完成后简要说明复盘文件已写入的位置。"
		].join("\n");
		try {
			agent.followup({
				id: `dsh-report-review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
				role: "user",
				content: [{
					type: "text",
					text: prompt
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-skill-manager"
				}
			});
			return {
				ok: true,
				message: `已触发复盘：agent 将读取所有 brief 并写入 reporter/Review/${date}.md`
			};
		} catch (error) {
			return {
				ok: false,
				error: errorMessage(error)
			};
		}
	}
	async function exportReport(args) {
		const cwd = cwdOf(args?.sessionId);
		if (cwd === "") return {
			ok: false,
			error: "无法确定工作区目录"
		};
		const sessionId = typeof args?.sessionId === "string" ? args.sessionId : "";
		if (sessionId === "") return {
			ok: false,
			error: "无法确定工作区目录"
		};
		await ensureDirectories(cwd, sessionId);
		const view = args?.view === "monthly" ? "monthly" : "daily";
		const data = view === "monthly" ? await generateMonthly(args) : await generateDaily(args);
		if (typeof data.lastError === "string" && data.lastError !== "") return {
			ok: false,
			error: data.lastError
		};
		const base = `report-${view}-${view === "monthly" ? data.month : data.date}`;
		const jsonPath = `${DATA_ROOT}/export/${base}.json`;
		const markdownPath = `${DATA_ROOT}/export/${base}.md`;
		try {
			const policy = policyOf(args?.sessionId);
			await fs.writeText(await fs.resolve(jsonPath, { cwd }), JSON.stringify(data, null, 2), void 0, void 0, policy);
			await fs.writeText(await fs.resolve(markdownPath, { cwd }), toMarkdown(data, view), void 0, void 0, policy);
			return {
				ok: true,
				jsonPath,
				mdPath: markdownPath
			};
		} catch (error) {
			return {
				ok: false,
				error: errorMessage(error)
			};
		}
	}
	const handlers = {
		generateDaily,
		generateMonthly,
		review,
		export: exportReport
	};
	const routeHandler = async (req, res) => {
		try {
			if (req.method !== "POST") {
				respondJson(res, 405, { error: "method not allowed" });
				return;
			}
			if (isCrossSiteRequest(req)) {
				respondJson(res, 403, { error: "跨站请求被拒绝" });
				return;
			}
			let body;
			try {
				body = await readJsonBody(req, MAX_BODY_BYTES$1);
			} catch (error) {
				respondJson(res, 400, { error: `请求体无效：${errorMessage(error)}` });
				return;
			}
			const method = body?.method;
			if (typeof method !== "string") {
				respondJson(res, 400, { error: "缺少 method 字段" });
				return;
			}
			const handler = handlers[method];
			if (handler === void 0) {
				respondJson(res, 404, { error: `未知方法：${method}` });
				return;
			}
			respondJson(res, 200, await handler(body?.args));
		} catch (error) {
			respondJson(res, 500, { error: errorMessage(error) });
		}
	};
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/api/report",
		handler: routeHandler
	}));
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region lib/types/index.js
/**
* Skill 全生命周期管理（host half）。
*
* 数据面全部复用 host 的 `skills` 分层注册表：目录浏览、详情读取、运行时
* 技能注册/卸载走注册表；文件夹技能的停用/重装/删除通过 shell 把条目移入
* 与技能根同级的 skill-manager/trash（可逆），chokidar 监听器自动使目录
* 失效。档案（方向/使用范围/能力边界/应用场景）持久化在工作区
* `.dsh/skill-manager/index.json`。
*
* 浏览器半通过 `POST /api/skill-manager`（JSON { method, args }）调用；
* 模型半通过注册进 tools 注册表的 `skill_archive` 工具写档案。
*
* 安全边界：所有文件操作的目标路径只来自注册表定义或本插件自己写入的
* 档案记录，绝不接受客户端任意路径；trash 目录固定在技能根同级的
* `skill-manager/trash` 下，重装/删除前校验路径前缀。
*/
/** 与 base bundle 选择 bash/pwsh 的分支一致（process.platform === 'win32'）。 */
const IS_WINDOWS = process.platform === "win32";
/** realpath 白名单：candidate 解析符号链接后必须仍落在 dir 的 realpath 内。
* dir 先解析——dir 不存在（记录里的 root 被篡改）一律返回 false 拒绝；
* candidate 不存在返回 null（已消失，由调用方决定）；其余失败返回 false。 */
async function realpathWithin(candidate, dir) {
	let rd;
	try {
		rd = await realpath(dir);
	} catch {
		return false;
	}
	try {
		const rc = await realpath(candidate);
		const rel = relative(rd, rc);
		return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
	} catch (error) {
		return error.code === "ENOENT" ? null : false;
	}
}
const name = "skill-manager";
/** Hard dependencies: the row waits for these services at cold boot instead of
* applying early and silently skipping registrations (insert rows may mount
* before some bundle rows have activated). */
const inject = [
	"skills",
	"tools",
	"webServer",
	"agents",
	"fs",
	"shell",
	"sandboxPolicy"
];
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BODY_BYTES = 1048576;
function apply(ctx) {
	const skills = ctx.get("skills");
	const agents = ctx.get("agents");
	const fs = ctx.get("fs");
	const shell = ctx.get("shell");
	const sandboxPolicy = ctx.get("sandboxPolicy");
	const tools = ctx.get("tools");
	const webServer = ctx.get("webServer");
	if (skills === void 0 || agents === void 0 || fs === void 0 || shell === void 0 || sandboxPolicy === void 0 || tools === void 0 || webServer === void 0) return;
	const owned = /* @__PURE__ */ new Map();
	ctx.effect(() => () => {
		for (const dispose of owned.values()) dispose();
		owned.clear();
	});
	function viewOptions(sessionId) {
		if (typeof sessionId !== "string") return {};
		const agent = agents.get(sessionId);
		if (agent === void 0) return {};
		return {
			scope: agent,
			cwd: agent.session.header.cwd
		};
	}
	function agentOf(sessionId) {
		if (typeof sessionId !== "string") return void 0;
		return agents.get(sessionId);
	}
	function cwdOf(sessionId) {
		return agentOf(sessionId)?.session.header.cwd;
	}
	function uuid4() {
		let s = "";
		for (let i = 0; i < 36; i += 1) {
			if (i === 8 || i === 13 || i === 18 || i === 23) {
				s += "-";
				continue;
			}
			if (i === 14) {
				s += "4";
				continue;
			}
			if (i === 19) {
				s += "89ab"[Math.floor(Math.random() * 4)];
				continue;
			}
			s += "0123456789abcdef"[Math.floor(Math.random() * 16)];
		}
		return s;
	}
	function userMessage(text) {
		return {
			role: "user",
			content: [{
				type: "text",
				text
			}],
			source: { kind: "user" },
			id: uuid4()
		};
	}
	async function runShell(command, targetPath, policyOverride) {
		const request = { command };
		if (policyOverride !== void 0) request.sandboxPolicy = policyOverride;
		else {
			const ws = sandboxPolicy.workspaceRoot;
			const mode = ws !== void 0 && isWithin(targetPath, ws) ? "workspace-write" : "danger-full-access";
			request.sandboxPolicy = sandboxPolicy.resolve({ mode });
		}
		const result = await shell.run(shell.resolve(request));
		if (result.sandbox !== void 0 && result.sandbox.denied === true) throw new Error(`文件操作被沙箱拒绝（${result.sandbox.mode}）`);
		if (result.exitCode !== 0) {
			const err = result.stderr !== null && result.stderr !== void 0 && typeof result.stderr.text === "string" ? result.stderr.text.trim() : "";
			throw new Error(`命令失败（exit ${String(result.exitCode)}）：${err}`);
		}
	}
	const indexStore = createIndexStore({
		async lockKey(cwd) {
			let canonical;
			try {
				canonical = await realpath(cwd);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				canonical = resolve(cwd);
			}
			return IS_WINDOWS ? canonical.toLowerCase() : canonical;
		},
		async read(cwd) {
			const target = await fs.resolve(join(cwd, ".dsh", "skill-manager", "index.json"), { cwd });
			return fs.readText(target);
		},
		async writeAtomic(cwd, value) {
			const dir = join(cwd, ".dsh", "skill-manager");
			const targetPath = join(dir, "index.json");
			const temporaryPath = join(dir, `.index.json.${process.pid}-${uuid4()}.tmp`);
			await runShell(mkdirCommand(dir, IS_WINDOWS), join(cwd, ".dsh"));
			const temporaryTarget = await fs.resolve(temporaryPath, { cwd });
			try {
				await fs.writeText(temporaryTarget, value);
				await runShell(atomicReplaceCommand(temporaryPath, targetPath, IS_WINDOWS), dir);
			} catch (error) {
				try {
					await runShell(removeFileCommand(temporaryPath, IS_WINDOWS), dir);
				} catch {}
				throw error;
			}
		}
	});
	const readIndex = (cwd) => indexStore.read(cwd);
	class IndexOperationRejected extends Error {
		response;
		constructor(response) {
			super(response.error);
			this.response = response;
		}
	}
	async function updateIndexOrReject(cwd, mutate) {
		try {
			return await indexStore.update(cwd, mutate);
		} catch (error) {
			if (error instanceof IndexOperationRejected) return error.response;
			throw error;
		}
	}
	function rejectIndexOperation(error) {
		throw new IndexOperationRejected({
			ok: false,
			error
		});
	}
	/** 记录一次技能调用：读取 index → 折叠进 usage → 回写。 */
	function recordSkillUse(cwd, name) {
		if (!NAME_RE.test(name)) return;
		indexStore.update(cwd, (index) => {
			recordUsage(index.usage, name, Date.now());
		}).catch(() => {});
	}
	if (ctx.on !== void 0) {
		const onEvent = ctx.on;
		onEvent("tools/result", (exec, result) => {
			if (exec?.name !== "skill" || result?.isError === true) return;
			const name = exec?.arguments?.name;
			if (typeof name !== "string" || name === "") return;
			const cwd = exec?.agent?.session?.header?.cwd;
			if (typeof cwd !== "string") return;
			recordSkillUse(cwd, name);
		});
		onEvent("agent/inbox/claimed", (payload) => {
			const cwd = payload?.agent?.session?.header?.cwd;
			if (typeof cwd !== "string") return;
			const message = payload?.message;
			if (message === null || typeof message !== "object" || message.source?.kind !== "user") return;
			const blocks = Array.isArray(message.content) ? message.content : [];
			for (const block of blocks) {
				if (block === null || typeof block !== "object" || block.type !== "text" || typeof block.text !== "string") continue;
				for (const name of skillGestures(block.text)) recordSkillUse(cwd, name);
			}
		});
	}
	/**
	* 从已建档技能中按相关性选出最匹配的候选。
	* @param agent 当前会话 agent
	* @param args { query, topK?, direction? }
	* @returns 排序后的短名单与给模型看的文本
	*/
	const runMatch = async (agent, args) => {
		const query = typeof args?.query === "string" ? args.query.trim() : "";
		const cwd = agent.session.header.cwd;
		const index = await readIndex(cwd);
		const profiles = Object.values(index.skills).filter((e) => typeof e.direction === "string" && e.direction !== "");
		const total = profiles.length;
		if (query === "" || total === 0) return {
			matches: [],
			total,
			text: total === 0 ? "还没有任何已建档技能（.dsh/skill-manager/index.json 为空）。先用 skill_archive 工具为技能建档。" : "请先输入任务描述（query）。"
		};
		const lookup = {
			scope: agent,
			cwd
		};
		let extraText = /* @__PURE__ */ new Map();
		try {
			const summaries = await skills.list(lookup);
			extraText = new Map(summaries.map((s) => [s.name, `${s.description} ${typeof s.whenToUse === "string" ? s.whenToUse : ""}`]));
		} catch {}
		const rawTopK = typeof args?.topK === "number" ? Math.trunc(args.topK) : 5;
		const topK = Math.min(20, Math.max(1, Number.isFinite(rawTopK) ? rawTopK : 5));
		const direction = typeof args?.direction === "string" && args.direction.trim() !== "" ? args.direction.trim() : void 0;
		const matches = matchSkills(query, profiles, {
			topK,
			direction
		}, extraText);
		let text = formatMatches(matches, total, query);
		if (matches.length === 0 && direction === void 0) {
			const dirs = [...new Set(profiles.map((p) => p.direction).filter((d) => typeof d === "string" && d !== ""))];
			text += `\n当前已建档技能的方向分类：${dirs.join("、")}。可指定 direction 过滤。`;
		}
		return {
			matches,
			total,
			text
		};
	};
	/**
	* 两段式路由：先用关键词命中判方向，再在命中方向内做词法检索。
	* 未命中方向时退化为全局检索并提示可选方向。
	* @param agent 当前会话 agent
	* @param args { query, topK? }
	*/
	const runRoute = async (agent, args) => {
		const query = typeof args?.query === "string" ? args.query.trim() : "";
		if (query === "") return runMatch(agent, args);
		const cwd = agent.session.header.cwd;
		const index = await readIndex(cwd);
		const profiles = Object.values(index.skills).filter((e) => typeof e.direction === "string" && e.direction !== "");
		const total = profiles.length;
		if (total === 0) return runMatch(agent, args);
		const lookup = {
			scope: agent,
			cwd
		};
		let extraText = /* @__PURE__ */ new Map();
		try {
			const summaries = await skills.list(lookup);
			extraText = new Map(summaries.map((s) => [s.name, `${s.description} ${typeof s.whenToUse === "string" ? s.whenToUse : ""}`]));
		} catch {}
		const rawTopK = typeof args?.topK === "number" ? Math.trunc(args.topK) : 5;
		const topK = Math.min(20, Math.max(1, Number.isFinite(rawTopK) ? rawTopK : 5));
		const dirs = detectDirections(query);
		const scoped = dirs.length === 0 ? profiles : profiles.filter((p) => p.direction !== void 0 && dirs.includes(p.direction));
		const matches = matchSkills(query, scoped, { topK }, extraText);
		let text;
		if (dirs.length === 0) {
			text = formatMatches(matches, total, query);
			text += `\n（未命中方向关键词，已做全局检索；可指定方向：${DIRECTION_LABELS.join("、")}）`;
		} else text = `命中方向：${dirs.join("、")}\n\n${formatMatches(matches, scoped.length, query)}`;
		return {
			matches,
			total,
			text
		};
	};
	if (tools !== void 0) {
		tools.register({
			name: "skill_archive",
			description: "为技能写档案（方向分类、使用范围、能力边界、应用场景），持久化到工作区 .dsh/skill-manager/index.json。先读取技能内容并分析，再调用本工具落盘。",
			parameters: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "技能名（kebab-case）"
					},
					direction: {
						type: "string",
						description: `方向分类，如：${DIRECTION_LABELS.join("/")}`
					},
					useScope: {
						type: "string",
						description: "使用范围：适用于哪些任务与场景"
					},
					boundaries: {
						type: "string",
						description: "能力边界：做不到什么、何时不适用"
					},
					scenarios: {
						type: "string",
						description: "应用场景：典型用例"
					},
					notes: {
						type: "string",
						description: "补充说明（可选）"
					},
					origin: {
						type: "string",
						description: "来源标注（可选）：self=自创，external=外来下载，system=系统内置，unknown=未标注"
					}
				},
				required: [
					"name",
					"direction",
					"useScope",
					"boundaries",
					"scenarios"
				]
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						message: { type: "string" }
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: String(value.message ?? "")
				}]
			},
			async execute(args, exec) {
				const name = typeof args.name === "string" ? args.name.trim() : "";
				if (!NAME_RE.test(name)) throw new Error(`无效的技能名：${name}`);
				const agent = exec.agent;
				if (agent === void 0) throw new Error("无法确定当前会话");
				const cwd = agent.session.header.cwd;
				const lookup = {
					scope: agent,
					cwd
				};
				const summary = (await skills.list(lookup)).find((s) => s.name === name);
				if (summary === void 0) throw new Error(`技能 "${name}" 不存在，请先安装或注册`);
				if (summary.source === "bundled") throw new Error(`技能 "${name}" 是 DSH 原生技能（bundled），由 harness 自行检索，无需建档`);
				const direction = typeof args.direction === "string" ? args.direction.trim() : "";
				const useScope = typeof args.useScope === "string" ? args.useScope.trim() : "";
				const boundaries = typeof args.boundaries === "string" ? args.boundaries.trim() : "";
				const scenarios = typeof args.scenarios === "string" ? args.scenarios.trim() : "";
				if (direction === "" || useScope === "" || boundaries === "" || scenarios === "") throw new Error("direction/useScope/boundaries/scenarios 均不能为空");
				if (!isDirectionLabel(direction)) throw new Error(`无效的方向「${direction}」。可选：${DIRECTION_LABELS.join("、")}`);
				const origin = args.origin === "self" || args.origin === "external" || args.origin === "system" || args.origin === "unknown" ? args.origin : "unknown";
				const definition = await skills.get(name, lookup);
				const contentHash = definition === void 0 ? void 0 : createHash("sha256").update(definition.content).digest("hex").slice(0, 16);
				const now = Date.now();
				await indexStore.update(cwd, (index) => {
					index.skills[name] = {
						name,
						direction,
						useScope,
						boundaries,
						scenarios,
						notes: typeof args.notes === "string" && args.notes.trim() !== "" ? args.notes.trim() : void 0,
						origin,
						updatedAt: now,
						reviewedAt: now,
						...contentHash !== void 0 ? { contentHash } : {}
					};
				});
				return {
					ok: true,
					message: `已为技能 "${name}" 建档（方向：${direction}）`
				};
			}
		});
		tools.register({
			name: "skill_match",
			description: "从已建档技能中找出最适合当前任务的技能。给定当前任务的一句话描述，读取工作区 .dsh/skill-manager/index.json 里的技能档案（方向/使用范围/能力边界/应用场景），按相关性返回最匹配的候选。当需要决定调用哪个 skill、或在多个技能间拿不准时使用；命中候选后再用 skill 工具加载其全文。",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "当前任务/目标的一句话描述（中文或英文），例如「调研某城市未来 20 年发展」「帮我写一个登录页面」"
					},
					topK: {
						type: "integer",
						description: "返回最相关的候选条数，默认 5，范围 1-20"
					},
					direction: {
						type: "string",
						description: `可选：只在该方向分类内匹配（${DIRECTION_LABELS.join("/")}）`
					}
				},
				required: ["query"]
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						matches: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									name: { type: "string" },
									direction: { type: "string" },
									useScope: { type: "string" },
									scenarios: { type: "string" },
									score: { type: "number" },
									matched: {
										type: "array",
										items: { type: "string" }
									}
								}
							}
						},
						total: { type: "integer" },
						text: { type: "string" }
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: String(value.text ?? "")
				}]
			},
			async execute(args, exec) {
				if ((typeof args.query === "string" ? args.query.trim() : "") === "") throw new Error("请提供 query：当前任务的一句话描述");
				const agent = exec.agent;
				if (agent === void 0) throw new Error("无法确定当前会话");
				return runMatch(agent, args);
			}
		});
		tools.register({
			name: "skill_route",
			description: "两段式技能路由：先用关键词命中判断任务属于哪个方向（工程代码/前端视觉/调研报告/内容写作/知识库/记忆会话/多代理编排/本地模型/元技能/命理玄学），再返回该方向内最相关的技能候选。比 skill_match 更省 token、更聚焦；命中候选后用 skill 工具加载全文。",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "当前任务/目标的一句话描述，例如「调研某行业前景」「写一个落地页」"
					},
					topK: {
						type: "integer",
						description: "返回最相关的候选条数，默认 5，范围 1-20"
					}
				},
				required: ["query"]
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						matches: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: true
							}
						},
						total: { type: "integer" },
						text: { type: "string" }
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: String(value.text ?? "")
				}]
			},
			async execute(args, exec) {
				if ((typeof args.query === "string" ? args.query.trim() : "") === "") throw new Error("请提供 query：当前任务的一句话描述");
				const agent = exec.agent;
				if (agent === void 0) throw new Error("无法确定当前会话");
				return runRoute(agent, args);
			}
		});
		tools.register({
			name: "skill_usage",
			description: "查看技能被调用的次数与频率统计（由本插件自动记录：模型经 skill 工具加载、或用户用 /name 手势调用都会计数）。省略 name 返回所有被调用过的技能（按次数降序）；给定 name 只看该技能的明细。",
			parameters: {
				type: "object",
				properties: { name: {
					type: "string",
					description: "可选：只看某个技能（kebab-case）；省略则返回所有被调用过的技能"
				} }
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: { text: { type: "string" } }
				},
				render: (_args, value) => [{
					type: "text",
					text: String(value.text ?? "")
				}]
			},
			async execute(args, exec) {
				const agent = exec.agent;
				if (agent === void 0) throw new Error("无法确定当前会话");
				const index = await readIndex(agent.session.header.cwd);
				const name = typeof args?.name === "string" && args.name.trim() !== "" ? args.name.trim() : void 0;
				return { text: formatUsage(index.usage, name, Date.now()) };
			}
		});
		tools.register({
			name: "skill_review",
			description: "找出待复审的技能（保鲜信号）：易变方向 + 长期未用 + 从未/久未复审，按优先级排序。用于决定「哪个 skill 该跑一轮 darwin-skill 评测/更新」。",
			parameters: {
				type: "object",
				properties: { topK: {
					type: "integer",
					description: "返回前几条待复审，默认 10"
				} }
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: { text: { type: "string" } }
				},
				render: (_args, value) => [{
					type: "text",
					text: String(value.text ?? "")
				}]
			},
			async execute(args, exec) {
				const agent = exec.agent;
				if (agent === void 0) throw new Error("无法确定当前会话");
				const index = await readIndex(agent.session.header.cwd);
				const rawTopK = typeof args?.topK === "number" ? Math.trunc(args.topK) : 10;
				const topK = Math.min(50, Math.max(1, Number.isFinite(rawTopK) ? rawTopK : 10));
				return { text: formatReview(reviewCandidates(index.skills, index.usage, Date.now(), topK), Object.keys(index.skills).length) };
			}
		});
		tools.register({
			name: "skill_eval",
			description: "触发对某个技能的有效性评测（对话框外）：加载 darwin-skill，用「带 skill vs 不带 skill」对比 + 中立 judge 评测该技能，然后用 record_eval 工具把结论写回档案。",
			parameters: {
				type: "object",
				properties: { name: {
					type: "string",
					description: "要评测的技能名（kebab-case）"
				} },
				required: ["name"]
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						message: { type: "string" }
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: String(value.message ?? "")
				}]
			},
			async execute(args, exec) {
				const name = typeof args.name === "string" ? args.name.trim() : "";
				if (!NAME_RE.test(name)) throw new Error(`无效的技能名：${name}`);
				const agent = exec.agent;
				if (agent === void 0) throw new Error("无法确定当前会话");
				const lookup = {
					scope: agent,
					cwd: agent.session.header.cwd
				};
				if ((await skills.list(lookup)).find((s) => s.name === name) === void 0) throw new Error(`技能 "${name}" 不存在`);
				agent.followup(userMessage(`请加载 darwin-skill，对技能「${name}」做一轮有效性评测：用「带 skill vs 不带 skill」跑同一基准任务、让中立 judge 打分，得出 score(0-10) 与 delta 描述，然后用 record_eval 工具把结论写回。`));
				return {
					ok: true,
					message: `已触发对技能 "${name}" 的评测（对话框外执行）`
				};
			}
		});
		tools.register({
			name: "record_eval",
			description: "把 darwin-skill 的评测结论写回技能档案：score(0-10)、baselineDelta(用 vs 不用的差异描述)、conclusion(有效/无效/待评测)。",
			parameters: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "技能名（kebab-case）"
					},
					score: {
						type: "number",
						description: "评测得分 0-10"
					},
					baselineDelta: {
						type: "string",
						description: "用 skill vs 不用的差异（一句话）"
					},
					conclusion: {
						type: "string",
						description: "有效 / 无效 / 待评测"
					}
				},
				required: ["name", "conclusion"]
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						message: { type: "string" }
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: String(value.message ?? "")
				}]
			},
			async execute(args, exec) {
				const name = typeof args.name === "string" ? args.name.trim() : "";
				if (!NAME_RE.test(name)) throw new Error(`无效的技能名：${name}`);
				const agent = exec.agent;
				if (agent === void 0) throw new Error("无法确定当前会话");
				const conclusion = args.conclusion === "有效" || args.conclusion === "无效" || args.conclusion === "待评测" ? args.conclusion : "待评测";
				await indexStore.update(agent.session.header.cwd, (index) => {
					const entry = index.skills[name];
					if (entry === null || typeof entry !== "object") throw new Error(`技能 "${name}" 未建档`);
					entry.evaluation = {
						score: typeof args.score === "number" && Number.isFinite(args.score) ? args.score : null,
						judgedAt: Date.now(),
						baselineDelta: typeof args.baselineDelta === "string" && args.baselineDelta.trim() !== "" ? args.baselineDelta.trim() : null,
						conclusion
					};
				});
				return {
					ok: true,
					message: `已记录技能 "${name}" 的评测结论：${conclusion}`
				};
			}
		});
	}
	const handlers = {
		async list(args) {
			const sessionId = args?.sessionId;
			const summaries = await skills.list(viewOptions(sessionId));
			const index = await readIndex(cwdOf(sessionId));
			return {
				skills: summaries.map((s) => ({
					name: s.name,
					description: s.description,
					whenToUse: typeof s.whenToUse === "string" ? s.whenToUse : null,
					modelInvocable: s.invocation.modelInvocable === true,
					userInvocable: s.invocation.userInvocable === true,
					source: s.source,
					provider: s.provider,
					owned: owned.has(s.name)
				})),
				index
			};
		},
		async get(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return null;
			const sessionId = typeof args.sessionId === "string" ? args.sessionId : void 0;
			const skill = await skills.get(args.name, viewOptions(sessionId));
			if (skill === void 0) return null;
			const index = await readIndex(cwdOf(sessionId));
			const profile = Object.prototype.hasOwnProperty.call(index.skills, skill.name) ? index.skills[skill.name] : null;
			return {
				name: skill.name,
				description: skill.description,
				whenToUse: typeof skill.whenToUse === "string" ? skill.whenToUse : null,
				content: skill.content,
				source: skill.source,
				provider: skill.provider,
				path: typeof skill.path === "string" ? skill.path : null,
				modelInvocable: skill.invocation.modelInvocable === true,
				userInvocable: skill.invocation.userInvocable === true,
				owned: owned.has(skill.name),
				profile
			};
		},
		async register(args) {
			if (args === null || typeof args !== "object") return {
				ok: false,
				error: "参数无效"
			};
			const name = typeof args.name === "string" ? args.name.trim() : "";
			const description = typeof args.description === "string" ? args.description.trim() : "";
			const content = typeof args.content === "string" ? args.content : "";
			if (!NAME_RE.test(name)) return {
				ok: false,
				error: "名称必须是 kebab-case（小写字母、数字、连字符）"
			};
			if (description === "") return {
				ok: false,
				error: "描述不能为空"
			};
			if (content.trim() === "") return {
				ok: false,
				error: "内容不能为空"
			};
			const opts = viewOptions(typeof args.sessionId === "string" ? args.sessionId : void 0);
			if ((await skills.list(opts)).some((s) => s.name === name) && !owned.has(name)) return {
				ok: false,
				error: `同名技能 "${name}" 已存在`
			};
			const previous = owned.get(name);
			if (previous !== void 0) {
				previous();
				owned.delete(name);
			}
			const dispose = skills.register({
				name,
				description,
				...typeof args.whenToUse === "string" && args.whenToUse.trim() !== "" ? { whenToUse: args.whenToUse.trim() } : {},
				content,
				source: "custom",
				invocation: {
					modelInvocable: args.modelInvocable !== false,
					userInvocable: args.userInvocable !== false
				}
			});
			owned.set(name, dispose);
			return { ok: true };
		},
		async unregister(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return {
				ok: false,
				error: "参数无效"
			};
			const dispose = owned.get(args.name);
			if (dispose === void 0) return {
				ok: false,
				error: "该技能不是本插件注册的临时技能"
			};
			dispose();
			owned.delete(args.name);
			return { ok: true };
		},
		async invoke(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return {
				ok: false,
				error: "参数无效"
			};
			const name = args.name;
			if (!NAME_RE.test(name)) return {
				ok: false,
				error: "无效的技能名"
			};
			const sessionId = typeof args.sessionId === "string" ? args.sessionId : void 0;
			const agent = agentOf(sessionId);
			if (agent === void 0) return {
				ok: false,
				error: "当前会话没有活跃的 agent"
			};
			const skill = await skills.get(name, viewOptions(sessionId));
			if (skill === void 0) return {
				ok: false,
				error: `技能 "${name}" 不存在`
			};
			if (skill.invocation.userInvocable !== true) return {
				ok: false,
				error: "该技能不允许用户显式调用"
			};
			agent.followup(userMessage(`/${name}`));
			return { ok: true };
		},
		async match(args) {
			const agent = agentOf(typeof args?.sessionId === "string" ? args.sessionId : void 0);
			if (agent === void 0) return {
				ok: false,
				error: "当前会话没有活跃的 agent"
			};
			return {
				ok: true,
				...await runMatch(agent, args)
			};
		},
		async ingest(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return {
				ok: false,
				error: "参数无效"
			};
			const name = args.name;
			if (!NAME_RE.test(name)) return {
				ok: false,
				error: "无效的技能名"
			};
			const sessionId = typeof args.sessionId === "string" ? args.sessionId : void 0;
			const agent = agentOf(sessionId);
			if (agent === void 0) return {
				ok: false,
				error: "当前会话没有活跃的 agent"
			};
			const skill = await skills.get(name, viewOptions(sessionId));
			if (skill === void 0) return {
				ok: false,
				error: `技能 "${name}" 不存在`
			};
			const prompt = `请为技能「${name}」建档：${typeof skill.path === "string" ? `先读取技能内容（路径：${skill.path}），` : "先用 skill 工具加载该技能，"}分析它属于哪个方向（候选：${DIRECTION_LABELS.join("、")}），然后调用 skill_archive 工具填写：方向 direction、使用范围 useScope、能力边界 boundaries、应用场景 scenarios。`;
			agent.followup(userMessage(prompt));
			return { ok: true };
		},
		async uninstall(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return {
				ok: false,
				error: "参数无效"
			};
			const name = args.name;
			const sessionId = typeof args.sessionId === "string" ? args.sessionId : void 0;
			const skill = await skills.get(name, viewOptions(sessionId));
			if (skill === void 0) return {
				ok: false,
				error: `技能 "${name}" 不存在`
			};
			const entryInfo = fsEntryOf(skill);
			if (entryInfo === void 0) return {
				ok: false,
				error: "该技能不是文件系统技能，无法停用"
			};
			const cwd = cwdOf(sessionId);
			if (cwd === void 0) return {
				ok: false,
				error: "无法确定当前工作目录"
			};
			const trashDir = trashDirOf(entryInfo.root);
			const removedAt = Date.now();
			const trashedPath = join(trashDir, `${name}-${removedAt}`);
			await indexStore.update(cwd, async (index) => {
				await runShell(mkdirCommand(trashDir, IS_WINDOWS), entryInfo.root);
				await runShell(moveNoClobberCommand(entryInfo.entry, trashedPath, IS_WINDOWS), entryInfo.root);
				index.trash[name] = {
					name,
					originalPath: entryInfo.entry,
					trashedPath,
					root: entryInfo.root,
					removedAt
				};
			});
			return { ok: true };
		},
		async reinstall(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return {
				ok: false,
				error: "参数无效"
			};
			const name = args.name;
			const cwd = cwdOf(typeof args.sessionId === "string" ? args.sessionId : void 0);
			if (cwd === void 0) return {
				ok: false,
				error: "无法确定当前工作目录"
			};
			return updateIndexOrReject(cwd, async (index) => {
				const record = index.trash[name];
				if (record === null || typeof record !== "object") rejectIndexOperation("未找到该技能的停用记录");
				const { trashedPath, originalPath, root } = record;
				if (typeof trashedPath !== "string" || typeof originalPath !== "string" || typeof root !== "string" || trashedPath === "" || originalPath === "" || root === "") rejectIndexOperation("停用记录损坏");
				if (await realpathWithin(trashedPath, trashDirOf(root)) !== true) rejectIndexOperation("停用记录路径异常，拒绝操作");
				if (!isWithin(originalPath, root)) rejectIndexOperation("停用记录路径异常，拒绝操作");
				await runShell(moveNoClobberCommand(trashedPath, originalPath, IS_WINDOWS), root);
				delete index.trash[name];
				return { ok: true };
			});
		},
		async deleteTrash(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return {
				ok: false,
				error: "参数无效"
			};
			const name = args.name;
			const cwd = cwdOf(typeof args.sessionId === "string" ? args.sessionId : void 0);
			if (cwd === void 0) return {
				ok: false,
				error: "无法确定当前工作目录"
			};
			return updateIndexOrReject(cwd, async (index) => {
				const record = index.trash[name];
				if (record === null || typeof record !== "object") rejectIndexOperation("未找到该技能的停用记录");
				const { trashedPath, root } = record;
				if (typeof trashedPath !== "string" || typeof root !== "string" || trashedPath === "" || root === "") rejectIndexOperation("停用记录损坏");
				if (await realpathWithin(trashedPath, trashDirOf(root)) === false) rejectIndexOperation("停用记录路径异常，拒绝操作");
				await runShell(removeRecursiveCommand(trashedPath, IS_WINDOWS), root);
				delete index.trash[name];
				return { ok: true };
			});
		},
		async setOrigin(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return {
				ok: false,
				error: "参数无效"
			};
			const name = args.name;
			if (!NAME_RE.test(name)) return {
				ok: false,
				error: "无效的技能名"
			};
			const origin = args.origin;
			if (origin !== "self" && origin !== "external" && origin !== "system" && origin !== "unknown") return {
				ok: false,
				error: "origin 必须是 self/external/system/unknown"
			};
			const cwd = cwdOf(typeof args.sessionId === "string" ? args.sessionId : void 0);
			if (cwd === void 0) return {
				ok: false,
				error: "无法确定当前工作目录"
			};
			await indexStore.update(cwd, (index) => {
				const entry = index.skills[name];
				if (entry === null || typeof entry !== "object") index.skills[name] = {
					name,
					origin,
					updatedAt: Date.now()
				};
				else {
					entry.origin = origin;
					entry.updatedAt = Date.now();
				}
			});
			return { ok: true };
		}
	};
	const routeHandler = async (req, res) => {
		try {
			if (req.method !== "POST") {
				respondJson(res, 405, { error: "method not allowed" });
				return;
			}
			if (isCrossSiteRequest(req)) {
				respondJson(res, 403, { error: "跨站请求被拒绝" });
				return;
			}
			let body;
			try {
				body = await readJsonBody(req, MAX_BODY_BYTES);
			} catch (error) {
				respondJson(res, 400, { error: `请求体无效：${String(error)}` });
				return;
			}
			const { method, args } = body ?? {};
			if (typeof method !== "string") {
				respondJson(res, 400, { error: "缺少 method 字段" });
				return;
			}
			const handler = handlers[method];
			if (handler === void 0) {
				respondJson(res, 404, { error: `未知方法：${method}` });
				return;
			}
			respondJson(res, 200, await handler(args));
		} catch (error) {
			respondJson(res, 500, { error: String(error) });
		}
	};
	if (webServer !== void 0) ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/api/skill-manager",
		handler: routeHandler
	}));
	if (webServer !== void 0 && agents !== void 0 && fs !== void 0 && sandboxPolicy !== void 0) registerReportApi(ctx, {
		webServer,
		agents,
		fs,
		sandboxPolicy,
		ensureDirectories: async (cwd, sessionId) => {
			const agent = agents.get(sessionId);
			if (agent === void 0) throw new Error("找不到对应 agent（会话可能已结束）");
			const policy = sandboxPolicy.resolve({ session: agent.session });
			for (const dir of [
				"brief",
				"Review",
				"export"
			]) {
				const target = join(cwd, "reporter", dir);
				await runShell(mkdirCommand(target, IS_WINDOWS), target, policy);
			}
		}
	});
}
//#endregion
export { apply, inject, name, realpathWithin };
