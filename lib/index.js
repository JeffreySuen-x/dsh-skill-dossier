import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { isAbsolute, join, relative, resolve } from "node:path";
//#region lib/types/directions.js
/**
* 技能方向分类的单一事实源：canonical 10 类 + 每类的易变性。host 与 client
* 都从这里 import，避免两处硬编码漂移。
*
* 「方向」是档案的分类轴，也是保鲜复审的输入之一：易变方向（volatility=high）
* 的内容更容易过时，复审优先级更高。检索不在这里——DSH 把技能目录
* （name + description）直接放进系统提示，由模型自己选，本插件不再做词法路由。
*/
/** canonical 10 类（顺序即 UI 展示顺序）。 */
const DIRECTIONS = [
	{
		label: "工程代码",
		description: "写代码、审查、测试、调试、架构与工程化",
		volatility: "high"
	},
	{
		label: "前端视觉",
		description: "UI、设计、落地页、产品界面、图转码与图生成",
		volatility: "high"
	},
	{
		label: "调研报告",
		description: "研究、行业/城市报告、数据采集与核实",
		volatility: "high"
	},
	{
		label: "内容写作",
		description: "文案、脚本、视频、写作与可视化表达",
		volatility: "low"
	},
	{
		label: "知识库",
		description: "笔记、Obsidian vault、wiki、溯源与第二大脑",
		volatility: "low"
	},
	{
		label: "记忆会话",
		description: "记忆、会话摘要、复盘与进度接续",
		volatility: "low"
	},
	{
		label: "多代理编排",
		description: "子代理、并行分发、工作流、任务拆解与交接",
		volatility: "low"
	},
	{
		label: "本地模型",
		description: "本地 Ollama 多模态预处理、离线编码与向量化",
		volatility: "high"
	},
	{
		label: "元技能",
		description: "技能蒸馏、造/改进/评估 skill、写 agent 文档",
		volatility: "low"
	},
	{
		label: "命理玄学",
		description: "八字、奇门、合盘、运势与团队匹配",
		volatility: "low"
	}
];
/** 全部方向名（工具描述与 UI 里用）。 */
const DIRECTION_LABELS = DIRECTIONS.map((d) => d.label);
/** 判断一个字符串是否为合法方向名。 */
function isDirectionLabel(label) {
	return DIRECTIONS.some((d) => d.label === label);
}
Object.fromEntries(DIRECTIONS.map((d) => [d.label, d.description]));
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
	return isWindows ? `[System.IO.Directory]::CreateDirectory(${quoteShellArg(dir, true)}) | Out-Null` : `mkdir -p ${quoteShellArg(dir, isWindows)}`;
}
function posixIdentityCommand(target, followSymlink = false) {
	const value = quoteShellArg(target, false);
	const dereference = followSymlink ? "-L " : "";
	return `stat ${dereference}-c '%d:%i' -- ${value} 2>/dev/null || stat ${dereference}-f '%d:%i' -- ${value} 2>/dev/null`;
}
function moveNoClobberCommand(src, dst, isWindows) {
	const source = quoteShellArg(src, isWindows);
	const destination = quoteShellArg(dst, isWindows);
	if (isWindows) return `if (-not ('DshSkillManagerNativeMove' -as [type])) { Add-Type -TypeDefinition ${quoteShellArg("using System; using System.Runtime.InteropServices; public static class DshSkillManagerNativeMove { [DllImport(\"kernel32.dll\", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool MoveFileEx(string existingName, string newName, uint flags); }", true)} }; if (-not ([DshSkillManagerNativeMove]::MoveFileEx(${source}, ${destination}, 0))) { $nativeError = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error(); throw [System.ComponentModel.Win32Exception]::new($nativeError) }`;
	const nestedPath = path.posix.join(dst, path.posix.basename(src));
	const destinationParentPath = path.posix.dirname(dst);
	const nested = quoteShellArg(nestedPath, false);
	const sourceIdentity = posixIdentityCommand(src);
	return `source_id=$(${sourceIdentity}) || { echo 'source missing' >&2; exit 18; }; destination_parent_id=$(${posixIdentityCommand(destinationParentPath, true)}) || { echo 'destination parent missing' >&2; exit 18; }; source_device=\${source_id%%:*}; destination_device=\${destination_parent_id%%:*}; if [ "$source_device" != "$destination_device" ]; then echo 'cross-device move is not supported' >&2; exit 18; fi; if [ -e ${destination} ] || [ -L ${destination} ]; then echo 'destination exists' >&2; exit 17; fi; mv -n -- ${source} ${destination} || exit $?; destination_id=$(${posixIdentityCommand(dst)}) || destination_id=''; if [ "$source_id" = "$destination_id" ]; then exit 0; fi; nested_id=$(${posixIdentityCommand(nestedPath)}) || nested_id=''; if [ "$source_id" = "$nested_id" ] && [ ! -e ${source} ] && [ ! -L ${source} ]; then mv -n -- ${nested} ${source} || { echo 'move race recovery failed' >&2; exit 19; }; restored_id=$(${sourceIdentity}) || restored_id=''; if [ "$source_id" != "$restored_id" ]; then echo 'move race recovery failed' >&2; exit 19; fi; fi; echo 'destination changed during move' >&2; exit 18`;
}
function removeRecursiveCommand(path, isWindows) {
	return isWindows ? `Remove-Item -Recurse -Force -LiteralPath ${quoteShellArg(path, true)}` : `rm -rf -- ${quoteShellArg(path, isWindows)}`;
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
		async update(cwd, mutate, recoverWriteFailure) {
			return enqueue(await (storage.lockKey?.(cwd) ?? cwd), async () => {
				const index = await load(cwd);
				const result = await mutate(index);
				try {
					await storage.writeAtomic(cwd, JSON.stringify(index, null, 2));
				} catch (error) {
					await recoverWriteFailure?.(error);
					throw error;
				}
				return result;
			});
		}
	};
}
//#endregion
//#region lib/types/tokens.js
/**
* 目录成本估算：技能目录（name + description）会整段进系统提示，技能越多越挤
* 上下文。这里给一个零依赖的近似值，用于在档案页回答「谁最占地方」。
*
* 口径是近似，不是分词器：CJK 按约 1 token/字，其余按约 4 字符/token（cl100k
* 量级）。绝对值会有偏差，但排序与量级足够用；UI 一律以「≈」呈现。
*/
/** 估算一段文本的 token 数（近似值，向上取整）。 */
function estimateTokens(text) {
	let cjk = 0;
	let other = 0;
	for (const char of String(text ?? "")) if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char)) cjk += 1;
	else other += 1;
	return cjk + Math.ceil(other / 4);
}
/** 估算一个技能在系统提示里的目录成本。 */
function estimateSkillTokens(name, description, whenToUse = "") {
	return estimateTokens(`${name} ${description} ${whenToUse}`.trim());
}
//#endregion
//#region lib/types/report-runs.js
/**
* 汇报的纯逻辑层：配置归一化、复盘提示词、结构化产物契约、brief 回写。
*
* 这里刻意不碰 I/O 与宿主服务——可测、可在客户端复用，也让 report.ts 只负责
* 「取会话、发提示词、读写文件」。所有默认值与原行为一致：不配置就等于没改。
*/
const DEFAULT_REPORT_CONFIG = {
	dataRoot: "reporter",
	briefDir: "brief",
	reviewDir: "Review",
	exportDir: "export",
	reviewSkill: "aeon-review",
	dispatch: "session",
	schedule: {
		enabled: false,
		hour: 22,
		checkMinutes: 30
	},
	runTimeoutMs: 6e5
};
function text(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function clock(value, max, fallback) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? Math.trunc(value) : fallback;
}
/**
* 归一化插件 config：任何缺失/非法字段都退回默认值，绝不因为一处配置写错
* 就让汇报整块不可用（DSH 的 patch 层是整体替换 config，不是合并）。
*/
function normalizeReportConfig(raw) {
	const value = raw ?? {};
	const schedule = value.schedule ?? {};
	const dispatch = value.dispatch === "subagent" ? "subagent" : "session";
	return {
		dataRoot: text(value.dataRoot) ?? DEFAULT_REPORT_CONFIG.dataRoot,
		briefDir: text(value.briefDir) ?? DEFAULT_REPORT_CONFIG.briefDir,
		reviewDir: text(value.reviewDir) ?? DEFAULT_REPORT_CONFIG.reviewDir,
		exportDir: text(value.exportDir) ?? DEFAULT_REPORT_CONFIG.exportDir,
		reviewSkill: typeof value.reviewSkill === "string" ? value.reviewSkill.trim() : DEFAULT_REPORT_CONFIG.reviewSkill,
		dispatch,
		schedule: {
			enabled: schedule.enabled === true,
			hour: clock(schedule.hour, 23, DEFAULT_REPORT_CONFIG.schedule.hour),
			checkMinutes: clock(schedule.checkMinutes, 1440, DEFAULT_REPORT_CONFIG.schedule.checkMinutes) || DEFAULT_REPORT_CONFIG.schedule.checkMinutes
		},
		runTimeoutMs: clock(value.runTimeoutMs, 864e5, DEFAULT_REPORT_CONFIG.runTimeoutMs) || DEFAULT_REPORT_CONFIG.runTimeoutMs
	};
}
/** 复盘产物的路径（相对于工作区）。 */
function reviewArtifacts(config, date) {
	const directory = `${config.dataRoot}/${config.reviewDir}`;
	return {
		directory,
		markdown: `${directory}/${date}.md`,
		json: `${directory}/${date}.json`
	};
}
/**
* 复盘提示词：优先按名加载 skill，同时把内联步骤写全作为回退——skill 未安装
* 或其依赖（如 aeon_* MCP 工具）未挂载时，这一步仍然能跑完，不会把一个能用
* 的按钮变成静默空操作。
*/
function buildReviewPrompt(options) {
	const { config, date } = options;
	const briefDir = `${config.dataRoot}/${config.briefDir}`;
	const { markdown, json } = reviewArtifacts(config, date);
	return [
		"【复盘任务】把每日简报整合成一份复盘。",
		"",
		"执行方式：",
		...config.reviewSkill === "" ? ["1. 直接按下面的步骤执行。"] : [`1. 先加载技能「${config.reviewSkill}」（用 skill 工具，参数 name="${config.reviewSkill}"），按它的流程执行。`, "2. 若该技能不存在、或其依赖的工具未挂载，则忽略它，直接按下面的步骤执行——不要因为技能不可用而中止。"],
		...options.dispatch === "subagent" ? ["3. 把这次复盘交给一个子代理完成（用 subagent 工具），你只负责汇总它的结论。"] : [],
		"",
		"步骤：",
		`1. 读取 ${briefDir}/ 目录下所有 YYYY-MM-DD.md 简报。`,
		"2. 按「结构化观察」提炼跨项目的踩坑、决策、可复用知识点（每条带发生日期与来源项目）。",
		"3. 按「周期复盘」聚合：完成了什么、关键收获、下一步、涌现主题、未记录到的成就。",
		`4. 写两个文件（目录不存在则创建）：`,
		`   - ${markdown}：给人看的 markdown 复盘。`,
		`   - ${json}：机器读的结构化产物，必须是**只含下列键**的 JSON 对象，七个键全部必填：`,
		"     {",
		`       "period": "本次复盘覆盖的日期区间，如 2026-09-01 ~ ${date}",`,
		"       \"projects\": [\"涉及的项目名\"],",
		"       \"completed\": [\"完成了什么，一条一句\"],",
		"       \"learnings\": [\"关键收获 / 可复用结论\"],",
		"       \"next\": [\"下一步\"],",
		"       \"openQuestions\": [\"还没想清楚或待验证的问题\"],",
		"       \"sourceBriefs\": [\"读了哪些简报文件，写文件名\"]",
		"     }",
		"     数组元素一律是字符串；不要加额外键，不要用 markdown 代码块包住整个文件。",
		"完成后用一句话说明两个文件已写入的位置。"
	].join("\n");
}
/** 把模型产出的 JSON 文本收成对象：容忍 ```json 围栏与前后废话。 */
function extractJsonObject(raw) {
	const value = String(raw ?? "").trim();
	if (value === "") return void 0;
	const candidate = (value.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? value).trim();
	try {
		return JSON.parse(candidate);
	} catch {
		const start = candidate.indexOf("{");
		const end = candidate.lastIndexOf("}");
		if (start < 0 || end <= start) return void 0;
		try {
			return JSON.parse(candidate.slice(start, end + 1));
		} catch {
			return;
		}
	}
}
const REVIEW_KEYS = [
	"period",
	"projects",
	"completed",
	"learnings",
	"next",
	"openQuestions",
	"sourceBriefs"
];
/**
* 校验复盘结构化产物：七个键全部必填、只允许这七个、值类型正确。
* 不通过就让面板回退到 markdown——契约漂移不该把一次成功的复盘变成白屏。
*/
function validateReviewReport(raw) {
	const value = extractJsonObject(typeof raw === "string" ? raw : "");
	const source = value !== void 0 ? value : raw;
	if (source === null || typeof source !== "object" || Array.isArray(source)) return {
		ok: false,
		error: "复盘产物不是 JSON 对象"
	};
	const record = source;
	const unknown = Object.keys(record).filter((key) => !REVIEW_KEYS.includes(key));
	if (unknown.length > 0) return {
		ok: false,
		error: `复盘产物含未知键：${unknown.join("、")}`
	};
	const missing = REVIEW_KEYS.filter((key) => !(key in record));
	if (missing.length > 0) return {
		ok: false,
		error: `复盘产物缺少键：${missing.join("、")}`
	};
	if (typeof record.period !== "string" || record.period.trim() === "") return {
		ok: false,
		error: "period 必须是非空字符串"
	};
	const lists = {};
	for (const key of REVIEW_KEYS) {
		if (key === "period") continue;
		const item = record[key];
		if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string")) return {
			ok: false,
			error: `${key} 必须是字符串数组`
		};
		lists[key] = item;
	}
	return {
		ok: true,
		value: {
			period: record.period.trim(),
			projects: lists.projects,
			completed: lists.completed,
			learnings: lists.learnings,
			next: lists.next,
			openQuestions: lists.openQuestions,
			sourceBriefs: lists.sourceBriefs
		}
	};
}
const BRIEF_SECTIONS = [
	{
		key: "progress",
		label: "今日进度"
	},
	{
		key: "todo",
		label: "待办"
	},
	{
		key: "issues",
		label: "问题"
	}
];
function sectionPattern(label) {
	return new RegExp(`^\\s*[-*]?\\s*${label}\\s*[:：]\\s*$`);
}
function isItemLine(line) {
	return /^\s*(?:\d+[.、)]|[-*])\s+\S/.test(line);
}
function isHeading(line) {
	return /^#{1,2}\s/.test(line);
}
/**
* 只追加、不改写：在 `## <project>` 区块内把条目追加到对应小节末尾，编号接续
* 已有条目。区块或小节不存在就补建；已有正文一行都不动——回写简报最怕的就是
* 覆盖掉人自己记的东西。
*/
function appendBriefItems(text, project, items) {
	const source = String(text ?? "");
	const pending = BRIEF_SECTIONS.map(({ key, label }) => ({
		key,
		label,
		values: (items[key] ?? []).map((value) => value.trim()).filter((value) => value !== "")
	})).filter(({ values }) => values.length > 0);
	if (pending.length === 0) return source;
	const lines = source === "" ? [] : source.split("\n");
	const heading = `## ${project}`;
	const start = lines.findIndex((line) => line.trim() === heading);
	if (start < 0) {
		const block = [heading];
		for (const { label, values } of pending) {
			block.push(`- ${label}：`);
			values.forEach((value, index) => block.push(`  ${index + 1}. ${value}`));
		}
		const trimmed = source.replace(/\s+$/, "");
		return `${trimmed === "" ? "" : `${trimmed}\n\n`}${block.join("\n")}\n`;
	}
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) if (isHeading(lines[index] ?? "")) {
		end = index;
		break;
	}
	const marks = BRIEF_SECTIONS.map(({ label }) => ({
		label,
		at: lines.findIndex((line, index) => index > start && index < end && sectionPattern(label).test(line))
	}));
	for (const { label, values } of pending) {
		const mark = marks.find((entry) => entry.label === label);
		if (mark.at < 0) {
			lines.splice(end, 0, `- ${label}：`, ...values.map((value, index) => `  ${index + 1}. ${value}`));
			end += 1 + values.length;
			continue;
		}
		const nexts = marks.map((entry) => entry.at).filter((at) => at > mark.at);
		const sectionEnd = nexts.length > 0 ? Math.min(...nexts) : end;
		let count = 0;
		let last = mark.at;
		for (let index = mark.at + 1; index < sectionEnd; index += 1) {
			const line = lines[index] ?? "";
			if (line.trim() === "") continue;
			if (!isItemLine(line)) continue;
			count += 1;
			last = index;
		}
		lines.splice(last + 1, 0, ...values.map((value, index) => `  ${count + index + 1}. ${value}`));
		end += values.length;
		for (const entry of marks) if (entry.at > mark.at) entry.at += values.length;
	}
	return lines.join("\n");
}
/** 该简报是否已经过去重后的可复盘内容（定时触发前的一次便宜检查）。 */
function briefHasProgress(projects) {
	return projects.some((project) => project.progress.length > 0);
}
//#endregion
//#region lib/types/report.js
const MAX_BODY_BYTES$1 = 1048576;
/** 保留的运行记录条数（内存态；历史看产物目录，不落额外状态文件）。 */
const RUN_HISTORY = 20;
/** 运行记录对外形状：剥掉内部快照。 */
function publicRun(run) {
	const { baseline: _baseline, ...rest } = run;
	return {
		...rest,
		elapsedMs: Date.now() - run.startedAt
	};
}
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
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Register `/api/report` as part of the manager package's host activation. */
function registerReportApi(ctx, deps) {
	const { webServer, agents, fs, sandboxPolicy, ensureDirectories } = deps;
	const config = deps.config ?? DEFAULT_REPORT_CONFIG;
	const runs = /* @__PURE__ */ new Map();
	/** 每个工作区最近一次汇报调用的会话：定时复盘需要一个能驱动 agent 的会话。 */
	const lastSessionByCwd = /* @__PURE__ */ new Map();
	/** 已触发过定时复盘的日期（每工作区每天一次）。 */
	const scheduledOn = /* @__PURE__ */ new Map();
	function cwdOf(sessionId) {
		if (typeof sessionId !== "string") return "";
		return agents.get(sessionId)?.session.header.cwd ?? "";
	}
	function policyOf(sessionId) {
		const agent = typeof sessionId === "string" ? agents.get(sessionId) : void 0;
		return agent === void 0 ? sandboxPolicy.resolve() : sandboxPolicy.resolve({ session: agent.session });
	}
	function rememberSession(sessionId) {
		const cwd = cwdOf(sessionId);
		if (cwd !== "" && typeof sessionId === "string") lastSessionByCwd.set(cwd, sessionId);
	}
	const briefPath = (date) => `${config.dataRoot}/${config.briefDir}/${date}.md`;
	async function readTextOrUndefined(path, cwd) {
		try {
			return await fs.readText(await fs.resolve(path, { cwd }));
		} catch (error) {
			if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return void 0;
			throw error;
		}
	}
	async function readBrief(cwd, date) {
		const relativePath = briefPath(date);
		const target = await fs.resolve(relativePath, { cwd });
		const text = await fs.readText(target);
		return {
			path: relativePath,
			date: extractDate(text) || date,
			projects: parseBrief(text)
		};
	}
	async function listBriefDates(cwd) {
		const target = await fs.resolve(`${config.dataRoot}/${config.briefDir}`, { cwd });
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
	async function listReviewArtifacts(cwd) {
		const target = await fs.resolve(`${config.dataRoot}/${config.reviewDir}`, { cwd });
		let entries;
		try {
			entries = await fs.listDir(target);
		} catch (error) {
			if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
			throw error;
		}
		const byDate = /* @__PURE__ */ new Map();
		for (const entry of entries) {
			const match = String(entry.name ?? entry.path ?? "").match(/^(\d{4}-\d{2}-\d{2})\.(md|json)$/);
			if (match?.[1] === void 0 || match[2] === void 0) continue;
			const record = byDate.get(match[1]) ?? {
				date: match[1],
				markdown: false,
				json: false
			};
			if (match[2] === "md") record.markdown = true;
			else record.json = true;
			byDate.set(match[1], record);
		}
		return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
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
			source: `${config.dataRoot}/${config.briefDir}/`,
			lastError: "无法确定工作区目录"
		};
		try {
			const pick = pickDailyDate(await listBriefDates(cwd), today);
			if (pick.date === "") return {
				date: today,
				projects: [],
				stats: emptyStats,
				source: `${config.dataRoot}/${config.briefDir}/`,
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
				source: `${config.dataRoot}/${config.briefDir}/`,
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
			source: `${config.dataRoot}/`,
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
				source: `${config.dataRoot}/`,
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
			source: `${config.dataRoot}/${config.briefDir}/`,
			lastError: skipped.length === 0 ? "" : `以下简报读取失败：${skipped.join("、")}`,
			fallbackMonth: pick.fallbackMonth
		};
	}
	function pruneRuns() {
		const terminal = [...runs.values()].filter((run) => run.status !== "running");
		if (terminal.length <= RUN_HISTORY) return;
		terminal.sort((a, b) => a.startedAt - b.startedAt);
		for (const run of terminal.slice(0, terminal.length - RUN_HISTORY)) runs.delete(run.id);
	}
	/**
	* 完成判据是**产物落盘**，不是「某一轮对话结束了」：DSH 的 prompt 回执不等于
	* turn 结束，靠 MessageId 关联轮次会在并发工作时串台。所以这里只问一个问题
	* ——我入队前那两个文件的内容，现在变了吗？
	*/
	async function refreshRun(cwd, run, now) {
		if (run.status !== "running") return run;
		const json = await readTextOrUndefined(run.jsonPath, cwd);
		const markdown = await readTextOrUndefined(run.markdownPath, cwd);
		const jsonChanged = json !== void 0 && json !== run.baseline?.json;
		const markdownChanged = markdown !== void 0 && markdown !== run.baseline?.markdown;
		if (jsonChanged) {
			const checked = validateReviewReport(json);
			run.status = "done";
			run.endedAt = now;
			if (checked.ok) {
				run.report = checked.value;
				run.artifact = "json";
			} else {
				run.artifact = markdownChanged ? "markdown" : "json";
				run.structuredError = checked.error;
			}
			return run;
		}
		if (markdownChanged) {
			run.status = "done";
			run.endedAt = now;
			run.artifact = "markdown";
			return run;
		}
		if (now - run.startedAt > config.runTimeoutMs) {
			run.status = "failed";
			run.endedAt = now;
			run.error = `等待产物超时（${Math.round(config.runTimeoutMs / 1e3)} 秒内 ${config.reviewDir}/ 下没有新文件）`;
		}
		return run;
	}
	async function startReview(args, trigger = "manual") {
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
		rememberSession(sessionId);
		await ensureDirectories(cwd, sessionId, config);
		const date = localDateKey();
		const artifacts = reviewArtifacts(config, date);
		const run = {
			id: `review-${date}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
			date,
			status: "running",
			startedAt: Date.now(),
			skill: config.reviewSkill,
			dispatch: config.dispatch,
			markdownPath: artifacts.markdown,
			jsonPath: artifacts.json
		};
		try {
			run.baseline = {
				json: await readTextOrUndefined(artifacts.json, cwd),
				markdown: await readTextOrUndefined(artifacts.markdown, cwd)
			};
			agent.followup({
				id: run.id,
				role: "user",
				content: [{
					type: "text",
					text: buildReviewPrompt({
						config,
						date,
						dispatch: config.dispatch
					})
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-skill-dossier"
				}
			});
		} catch (error) {
			run.status = "failed";
			run.endedAt = Date.now();
			run.error = errorMessage(error);
			runs.set(run.id, run);
			return {
				ok: false,
				runId: run.id,
				error: `复盘任务入队失败：${run.error}`
			};
		}
		runs.set(run.id, run);
		pruneRuns();
		return {
			ok: true,
			runId: run.id,
			trigger,
			message: `已触发复盘${config.reviewSkill === "" ? "" : `（技能 ${config.reviewSkill}）`}：产物写入 ${artifacts.markdown} 与 ${artifacts.json}`
		};
	}
	async function reviewStatus(args) {
		const sessionId = args?.sessionId;
		const cwd = cwdOf(sessionId);
		if (cwd === "") return {
			ok: false,
			error: "无法确定工作区目录"
		};
		const id = typeof args?.runId === "string" ? args.runId : "";
		const run = runs.get(id);
		if (run === void 0) return {
			ok: true,
			run: null
		};
		return {
			ok: true,
			run: publicRun(await refreshRun(cwd, run, Date.now()))
		};
	}
	async function reviewRuns(args) {
		const sessionId = args?.sessionId;
		const cwd = cwdOf(sessionId);
		if (cwd === "") return {
			ok: false,
			error: "无法确定工作区目录"
		};
		for (const run of runs.values()) await refreshRun(cwd, run, Date.now());
		const history = await listReviewArtifacts(cwd);
		return {
			ok: true,
			runs: [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).map(publicRun),
			history
		};
	}
	async function cancelReview(args) {
		const id = typeof args?.runId === "string" ? args.runId : "";
		const run = runs.get(id);
		if (run === void 0) return {
			ok: false,
			error: "找不到该运行记录"
		};
		if (run.status !== "running") return {
			ok: false,
			error: `该运行已结束（${run.status}）`
		};
		run.status = "cancelled";
		run.endedAt = Date.now();
		run.error = "已停止跟踪（agent 正在执行的那一轮不会被中断）";
		return { ok: true };
	}
	async function appendBrief(args) {
		const sessionId = args?.sessionId;
		const cwd = cwdOf(sessionId);
		if (cwd === "" || typeof sessionId !== "string") return {
			ok: false,
			error: "无法确定工作区目录"
		};
		const project = typeof args?.project === "string" ? args.project.trim() : "";
		if (project === "") return {
			ok: false,
			error: "缺少项目名"
		};
		const items = {
			progress: Array.isArray(args?.items?.progress) ? args.items.progress.filter((v) => typeof v === "string") : void 0,
			todo: Array.isArray(args?.items?.todo) ? args.items.todo.filter((v) => typeof v === "string") : void 0,
			issues: Array.isArray(args?.items?.issues) ? args.items.issues.filter((v) => typeof v === "string") : void 0
		};
		const date = typeof args?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : localDateKey();
		await ensureDirectories(cwd, sessionId, config);
		const path = briefPath(date);
		try {
			const text = await readTextOrUndefined(path, cwd) ?? `---\ndate: ${date}\n---\n\n# Brief\n`;
			const next = appendBriefItems(text, project, items);
			if (next === text) return {
				ok: true,
				path,
				appended: 0
			};
			const policy = policyOf(sessionId);
			await fs.writeText(await fs.resolve(path, { cwd }), next, void 0, void 0, policy);
			return {
				ok: true,
				path,
				appended: (items.progress?.length ?? 0) + (items.todo?.length ?? 0) + (items.issues?.length ?? 0)
			};
		} catch (error) {
			return {
				ok: false,
				error: errorMessage(error)
			};
		}
	}
	async function scheduledTick() {
		if (!config.schedule.enabled) return;
		if ((/* @__PURE__ */ new Date()).getHours() < config.schedule.hour) return;
		const today = localDateKey();
		for (const [cwd, sessionId] of lastSessionByCwd) {
			if (scheduledOn.get(cwd) === today) continue;
			if (agents.get(sessionId) === void 0) continue;
			let daily;
			try {
				daily = await generateDaily({ sessionId });
			} catch {
				continue;
			}
			if (typeof daily?.lastError === "string" && daily.lastError !== "") continue;
			if (daily?.date !== today || !briefHasProgress(daily.projects ?? [])) continue;
			if ((await listReviewArtifacts(cwd)).some((entry) => entry.date === today)) {
				scheduledOn.set(cwd, today);
				continue;
			}
			if ((await startReview({ sessionId }, "schedule")).ok === true) scheduledOn.set(cwd, today);
		}
	}
	if (deps.interval !== void 0) {
		const interval = deps.interval;
		ctx.effect(() => interval(() => {
			scheduledTick();
		}, config.schedule.checkMinutes * 60 * 1e3));
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
		await ensureDirectories(cwd, sessionId, config);
		const view = args?.view === "monthly" ? "monthly" : "daily";
		const data = view === "monthly" ? await generateMonthly(args) : await generateDaily(args);
		if (typeof data.lastError === "string" && data.lastError !== "") return {
			ok: false,
			error: data.lastError
		};
		const base = `report-${view}-${view === "monthly" ? data.month : data.date}`;
		const jsonPath = `${config.dataRoot}/${config.exportDir}/${base}.json`;
		const markdownPath = `${config.dataRoot}/${config.exportDir}/${base}.md`;
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
		review: (args) => startReview(args, "manual"),
		reviewStatus,
		reviewRuns,
		cancelReview,
		appendBrief,
		export: exportReport,
		reportConfig: async () => ({
			ok: true,
			config
		})
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
			rememberSession(body?.args?.sessionId);
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
function apply(ctx, config) {
	const skills = ctx.get("skills");
	const agents = ctx.get("agents");
	const fs = ctx.get("fs");
	const shell = ctx.get("shell");
	const sandboxPolicy = ctx.get("sandboxPolicy");
	const tools = ctx.get("tools");
	const webServer = ctx.get("webServer");
	if (skills === void 0 || agents === void 0 || fs === void 0 || shell === void 0 || sandboxPolicy === void 0 || tools === void 0 || webServer === void 0) return;
	const owned = /* @__PURE__ */ new Map();
	const temporaryBarriers = /* @__PURE__ */ new WeakMap();
	let active = true;
	ctx.effect(() => () => {
		active = false;
		for (const state of [...owned.values()]) {
			for (const dispose of state.registrations.values()) dispose();
			state.registrations.clear();
			state.disposeOwnership();
		}
		owned.clear();
	});
	function ownedBy(agent) {
		const existing = owned.get(agent);
		if (existing !== void 0) return existing;
		const registrations = /* @__PURE__ */ new Map();
		let state;
		state = {
			registrations,
			disposeOwnership: agent.ctx.effect(() => () => {
				registrations.clear();
				if (state !== void 0 && owned.get(agent) === state) owned.delete(agent);
			})
		};
		owned.set(agent, state);
		return state;
	}
	function releaseOwned(agent, state, name, dispose) {
		if (state.registrations.get(name) !== dispose) return;
		dispose();
		state.registrations.delete(name);
		releaseEmptyOwnership(agent, state);
	}
	function releaseEmptyOwnership(agent, state) {
		if (state.registrations.size === 0 && owned.get(agent) === state) state.disposeOwnership();
	}
	function isOwned(sessionId, name) {
		const agent = agentOf(sessionId);
		return agent !== void 0 && owned.get(agent)?.registrations.has(name) === true;
	}
	function enqueueTemporary(agent, task) {
		const result = (temporaryBarriers.get(agent) ?? Promise.resolve()).then(task, task);
		const barrier = result.then(() => void 0, () => void 0);
		temporaryBarriers.set(agent, barrier);
		barrier.then(() => {
			if (temporaryBarriers.get(agent) === barrier) temporaryBarriers.delete(agent);
		});
		return result;
	}
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
	function errorMessage(error) {
		return error instanceof Error ? error.message : String(error);
	}
	/** 从失败的 tools/result 里取一句可读原因（截断存放，避免撑大索引）。 */
	function failureText(result) {
		const trimmed = `${typeof result?.error === "string" ? result.error : ""} ${(Array.isArray(result?.content) ? result.content : []).map((block) => typeof block?.text === "string" ? block.text : "").join(" ")}`.replace(/\s+/g, " ").trim();
		return trimmed === "" ? "加载失败（未提供原因）" : trimmed.slice(0, 200);
	}
	async function rollbackMoveAfterCommitFailure(operationError, source, destination, root) {
		try {
			await runShell(moveNoClobberCommand(source, destination, IS_WINDOWS), root);
		} catch (rollbackError) {
			throw new Error(`索引提交失败：${errorMessage(operationError)}；文件回滚失败：${errorMessage(rollbackError)}`);
		}
	}
	/**
	* 索引写在自己描述的那个工作区里，所以策略必须是「以该工作区为根」的
	* workspace-write。缺省策略走的是部署回退根（`sandbox-policy.workspaceRoot`，
	* 默认 `process.cwd()`）——跨工作区打开的会话不在其下，fs 沙箱会以
	* FS_SANDBOX_DENIED 拒绝写入，而这条写路径是档案、调用统计与生命周期提交的
	* 共同出口，一旦被拒就是全量静默失效。
	*/
	function indexWritePolicy(cwd) {
		return {
			mode: "workspace-write",
			workspaceRoot: cwd
		};
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
				await fs.writeText(temporaryTarget, value, void 0, void 0, indexWritePolicy(cwd));
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
	async function updateIndexOrReject(cwd, mutate, recoverWriteFailure) {
		try {
			return await indexStore.update(cwd, mutate, recoverWriteFailure);
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
	/** host logger 可能缺席（测试夹具/精简组合），缺失时只保留状态位。 */
	const logger = ctx.logger;
	/** 最近一次调用统计写入失败的原因；null = 正常。埋点失败不打断技能本身，
	* 但绝不静默——面板据此提示「统计不可用」，而不是端出一张空表。 */
	let usageWriteFailure = null;
	/** 记录一次技能调用：读取 index → 折叠进 usage 与实测结果 → 回写。 */
	function recordSkillUse(cwd, name, failure) {
		if (!NAME_RE.test(name)) return;
		indexStore.update(cwd, (index) => {
			const at = Date.now();
			recordUsage(index.usage, name, at);
			const entry = index.skills[name];
			if (entry !== void 0 && entry !== null && typeof entry === "object") {
				const outcomes = entry.outcomes ?? {
					loaded: 0,
					failed: 0,
					lastAt: at
				};
				if (failure === void 0) {
					outcomes.loaded += 1;
					delete outcomes.lastError;
				} else {
					outcomes.failed += 1;
					outcomes.lastError = failure;
				}
				outcomes.lastAt = at;
				entry.outcomes = outcomes;
			}
		}).then(() => {
			usageWriteFailure = null;
		}, (error) => {
			const message = errorMessage(error);
			if (usageWriteFailure === message) return;
			usageWriteFailure = message;
			logger?.warn?.(`skill-manager: 技能调用统计写入失败（不打断技能本身）：${message}`);
		});
	}
	if (ctx.on !== void 0) {
		const onEvent = ctx.on;
		onEvent("tools/result", (exec, result) => {
			if (exec?.name !== "skill") return;
			const name = exec?.arguments?.name;
			if (typeof name !== "string" || name === "") return;
			const cwd = exec?.agent?.session?.header?.cwd;
			if (typeof cwd !== "string") return;
			if (result?.isError !== true) {
				recordSkillUse(cwd, name);
				return;
			}
			recordSkillUse(cwd, name, failureText(result));
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
			let catalogTokens = 0;
			return {
				skills: summaries.map((s) => {
					const approxTokens = estimateSkillTokens(s.name, s.description, typeof s.whenToUse === "string" ? s.whenToUse : "");
					catalogTokens += approxTokens;
					return {
						name: s.name,
						description: s.description,
						whenToUse: typeof s.whenToUse === "string" ? s.whenToUse : null,
						modelInvocable: s.invocation.modelInvocable === true,
						userInvocable: s.invocation.userInvocable === true,
						source: s.source,
						provider: s.provider,
						owned: isOwned(sessionId, s.name),
						approxTokens
					};
				}),
				index,
				usageHealth: usageWriteFailure,
				catalogTokens
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
				owned: isOwned(sessionId, skill.name),
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
			const sessionId = typeof args.sessionId === "string" ? args.sessionId : void 0;
			const agent = agentOf(sessionId);
			if (agent === void 0) return {
				ok: false,
				error: "当前会话没有活跃的 agent"
			};
			return enqueueTemporary(agent, async () => {
				if (!active || agentOf(sessionId) !== agent) return {
					ok: false,
					error: "插件或当前会话已停止"
				};
				const scopedSkills = agent.ctx.get("skills");
				if (scopedSkills === void 0) return {
					ok: false,
					error: "当前会话的 skills 服务不可用"
				};
				let state;
				try {
					state = ownedBy(agent);
				} catch {
					return {
						ok: false,
						error: "插件或当前会话已停止"
					};
				}
				const view = {
					scope: agent,
					cwd: agent.session.header.cwd
				};
				let existing;
				try {
					existing = (await skills.list(view)).some((s) => s.name === name);
				} catch (error) {
					releaseEmptyOwnership(agent, state);
					throw error;
				}
				if (!active || agentOf(sessionId) !== agent || owned.get(agent) !== state) {
					releaseEmptyOwnership(agent, state);
					return {
						ok: false,
						error: "插件或当前会话已停止"
					};
				}
				if (existing && !state.registrations.has(name)) {
					releaseEmptyOwnership(agent, state);
					return {
						ok: false,
						error: `同名技能 "${name}" 已存在`
					};
				}
				const current = state.registrations.get(name);
				if (current !== void 0) {
					current();
					state.registrations.delete(name);
				}
				const provider = `dsh-skill-dossier:${uuid4()}`;
				let dispose;
				try {
					dispose = scopedSkills.register({
						name,
						description,
						...typeof args.whenToUse === "string" && args.whenToUse.trim() !== "" ? { whenToUse: args.whenToUse.trim() } : {},
						content,
						source: "custom",
						provider,
						invocation: {
							modelInvocable: args.modelInvocable !== false,
							userInvocable: args.userInvocable !== false
						}
					});
				} catch {
					releaseEmptyOwnership(agent, state);
					return {
						ok: false,
						error: "插件或当前会话已停止"
					};
				}
				state.registrations.set(name, dispose);
				let winner;
				try {
					winner = await skills.get(name, view);
				} catch (error) {
					releaseOwned(agent, state, name, dispose);
					throw error;
				}
				if (!active || agentOf(sessionId) !== agent || owned.get(agent) !== state || state.registrations.get(name) !== dispose) {
					releaseOwned(agent, state, name, dispose);
					return {
						ok: false,
						error: "插件或当前会话已停止"
					};
				}
				if (winner?.provider !== provider) {
					releaseOwned(agent, state, name, dispose);
					return {
						ok: false,
						error: `同名技能 "${name}" 已存在`
					};
				}
				return { ok: true };
			});
		},
		async unregister(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return {
				ok: false,
				error: "参数无效"
			};
			const sessionId = typeof args.sessionId === "string" ? args.sessionId : void 0;
			const agent = agentOf(sessionId);
			if (agent === void 0) return {
				ok: false,
				error: "当前会话没有活跃的 agent"
			};
			return enqueueTemporary(agent, async () => {
				if (!active || agentOf(sessionId) !== agent) return {
					ok: false,
					error: "插件或当前会话已停止"
				};
				const state = owned.get(agent);
				if (state === void 0) return {
					ok: false,
					error: "该技能不是本会话注册的临时技能"
				};
				const dispose = state.registrations.get(args.name);
				if (dispose === void 0) return {
					ok: false,
					error: "该技能不是本会话注册的临时技能"
				};
				releaseOwned(agent, state, args.name, dispose);
				return { ok: true };
			});
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
			let moved = false;
			await indexStore.update(cwd, async (index) => {
				await runShell(mkdirCommand(trashDir, IS_WINDOWS), entryInfo.root);
				await runShell(moveNoClobberCommand(entryInfo.entry, trashedPath, IS_WINDOWS), entryInfo.root);
				moved = true;
				index.trash[name] = {
					name,
					originalPath: entryInfo.entry,
					trashedPath,
					root: entryInfo.root,
					removedAt
				};
			}, async (error) => {
				if (moved) await rollbackMoveAfterCommitFailure(error, trashedPath, entryInfo.entry, entryInfo.root);
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
			let rollback;
			return updateIndexOrReject(cwd, async (index) => {
				const record = index.trash[name];
				if (record === null || typeof record !== "object") rejectIndexOperation("未找到该技能的停用记录");
				const { trashedPath, originalPath, root } = record;
				if (typeof trashedPath !== "string" || typeof originalPath !== "string" || typeof root !== "string" || trashedPath === "" || originalPath === "" || root === "") rejectIndexOperation("停用记录损坏");
				if (await realpathWithin(trashedPath, trashDirOf(root)) !== true) rejectIndexOperation("停用记录路径异常，拒绝操作");
				if (!isWithin(originalPath, root)) rejectIndexOperation("停用记录路径异常，拒绝操作");
				await runShell(moveNoClobberCommand(trashedPath, originalPath, IS_WINDOWS), root);
				rollback = {
					source: originalPath,
					destination: trashedPath,
					root
				};
				delete index.trash[name];
				return { ok: true };
			}, async (error) => {
				if (rollback !== void 0) await rollbackMoveAfterCommitFailure(error, rollback.source, rollback.destination, rollback.root);
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
	if (webServer !== void 0 && agents !== void 0 && fs !== void 0 && sandboxPolicy !== void 0) {
		const reportConfig = normalizeReportConfig(config?.report);
		const timer = ctx.get("timer");
		registerReportApi(ctx, {
			webServer,
			agents,
			fs,
			sandboxPolicy,
			config: reportConfig,
			...typeof timer?.interval === "function" ? { interval: (callback, delayMs) => timer.interval(callback, delayMs) } : {},
			ensureDirectories: async (cwd, sessionId, active) => {
				const agent = agents.get(sessionId);
				if (agent === void 0) throw new Error("找不到对应 agent（会话可能已结束）");
				const policy = sandboxPolicy.resolve({ session: agent.session });
				for (const dir of [
					active.briefDir,
					active.reviewDir,
					active.exportDir
				]) {
					const target = join(cwd, active.dataRoot, dir);
					await runShell(mkdirCommand(target, IS_WINDOWS), target, policy);
				}
			}
		});
	}
}
//#endregion
export { apply, inject, name, realpathWithin };
