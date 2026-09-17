import { realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
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
	return `在 ${total} 条技能里，待复审优先级最高的 ${entries.length} 条：\n\n${lines.join("\n")}\n\n对可疑的一条加载 darwin-skill 跑评测；它把结果写进 .dsh/skills/darwin-skill/results.tsv，档案页的「证据」一栏会读它。`;
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
* 纯函数：路径解析与 POSIX shell 命令生成。
*
* 路径操作通过注入的 {@link PathFns} 完成，命令生成一律是 bash/POSIX —— 本插件
* 只支持 macOS 与 Linux。**Windows 支持已在 2026-09-17 撤除**：那条支线（pwsh
* 命令、`MoveFileExW` 原生移动）从未在真机上被验证过，却让 CI 长期挂着一条红腿，
* 而一个常红的门会吃掉它后面所有门的信号——要恢复就得先有真机验证，别只把分支加回来。
*/
/** 默认按运行平台（node:path）。 */
const defaultPath = path;
/**
* 判断 candidate 词法解析后是否仍在 dir 目录内（解析 `..`，不解析符号链接）。
*
* 判据必须是**按路径段**比较：早期版本用 `rel.startsWith('..')`，于是 `<dir>/..foo/x`
* 这种名字以 `..` 开头的正常子目录会被误判成「在外面」。这不是纯美观问题——调用方
* 拿它决定沙箱档位（`isWithin(target, ws) ? 'workspace-write' : 'danger-full-access'`），
* 误判会把本可受限执行的 `mv`/`rm -rf` 升格成全权执行。
*
* `relative` 跨盘（Windows）时返回目标绝对路径，故用 isAbsolute 一并拦截。
*/
function isWithin(candidate, dir, p = defaultPath) {
	const rel = p.relative(p.resolve(dir), p.resolve(candidate));
	if (rel === "") return true;
	if (p.isAbsolute(rel)) return false;
	return !rel.split(p.sep).includes("..");
}
/**
* 从注册表定义解析可移动的文件系统条目（只信任注册表给的路径）。
*
* 判据是**路径形状**，不是「目录名等于技能名」：只要注册表给的 `path` 是
* `<root>/<dir>/SKILL.md` 或 `<root>/<name>.md`，root 就由路径反推。
* 早期版本额外要求 `basename(dirname(path)) === skill.name`，于是目录名与
* frontmatter `name` 不一致的技能（本机实测 4 个：`book-to-skill-master`、
* `god-skill-main` 等）会被误判成「不是文件系统技能」，生命周期操作全废。
* 目录名是源仓库的目录名，frontmatter `name` 才是调用名——两者不必然相等。
*
* 路径必须是绝对的：`'SKILL.md'` 这种相对路径会反推出 `root: '..'`，而 root 会喂给
* `trashDirOf()` 与 `rm -rf`，entry 会作为 `mv` 的源（cwd = root）。
*/
function fsEntryOf(skill, p = defaultPath) {
	if (typeof skill.path !== "string" || !p.isAbsolute(skill.path)) return void 0;
	const base = p.basename(skill.path);
	if (base === "SKILL.md") {
		const dir = p.dirname(skill.path);
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
/** 把值转成 shell 单引号参数（POSIX：内嵌单引号写成 '\''）。 */
function quoteShellArg(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}
function mkdirCommand(dir) {
	return `mkdir -p ${quoteShellArg(dir)}`;
}
function posixIdentityCommand(target, followSymlink = false) {
	const value = quoteShellArg(target);
	const dereference = followSymlink ? "-L " : "";
	return `stat ${dereference}-c '%d:%i' -- ${value} 2>/dev/null || stat ${dereference}-f '%d:%i' -- ${value} 2>/dev/null`;
}
function moveNoClobberCommand(src, dst) {
	const source = quoteShellArg(src);
	const destination = quoteShellArg(dst);
	const nestedPath = path.posix.join(dst, path.posix.basename(src));
	const destinationParentPath = path.posix.dirname(dst);
	const nested = quoteShellArg(nestedPath);
	const sourceIdentity = posixIdentityCommand(src);
	return `source_id=$(${sourceIdentity}) || { echo 'source missing' >&2; exit 18; }; destination_parent_id=$(${posixIdentityCommand(destinationParentPath, true)}) || { echo 'destination parent missing' >&2; exit 18; }; source_device=\${source_id%%:*}; destination_device=\${destination_parent_id%%:*}; if [ "$source_device" != "$destination_device" ]; then echo 'cross-device move is not supported' >&2; exit 18; fi; if [ -e ${destination} ] || [ -L ${destination} ]; then echo 'destination exists' >&2; exit 17; fi; mv -n -- ${source} ${destination} || exit $?; destination_id=$(${posixIdentityCommand(dst)}) || destination_id=''; if [ "$source_id" = "$destination_id" ]; then exit 0; fi; nested_id=$(${posixIdentityCommand(nestedPath)}) || nested_id=''; if [ "$source_id" = "$nested_id" ] && [ ! -e ${source} ] && [ ! -L ${source} ]; then mv -n -- ${nested} ${source} || { echo 'move race recovery failed' >&2; exit 19; }; restored_id=$(${sourceIdentity}) || restored_id=''; if [ "$source_id" != "$restored_id" ]; then echo 'move race recovery failed' >&2; exit 19; fi; fi; echo 'destination changed during move' >&2; exit 18`;
}
function removeRecursiveCommand(path) {
	return `rm -rf -- ${quoteShellArg(path)}`;
}
/** Replace a file by renaming a same-directory temporary file over it. */
function atomicReplaceCommand(src, dst) {
	return `mv -f -- ${quoteShellArg(src)} ${quoteShellArg(dst)}`;
}
/** Remove one staging file without interpreting wildcard characters. */
function removeFileCommand(path) {
	return `rm -f -- ${quoteShellArg(path)}`;
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
const MAX_BODY_BYTES = 1048576;
/**
* 两个 API（`/api/skill-manager`、`/api/report`）共用的路由骨架：只接受 POST、
* 拒跨站、限体积、按 `{ method, args }` 派发、统一包错误。
*
* 收成一处不是为了少几行，而是**安全边界只能有一个实现**——同源校验曾经在
* 两个路由里各写一遍，结果一个 403、一个 200（2026-09-03 修）。
*/
function createRpcRoute(options) {
	const { handlers, before } = options;
	return async (req, res) => {
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
				respondJson(res, 400, { error: `请求体无效：${errorMessage$1(error)}` });
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
			const args = body?.args;
			if (before !== void 0) await before(args);
			respondJson(res, 200, await handler(args));
		} catch (error) {
			respondJson(res, 500, { error: errorMessage$1(error) });
		}
	};
}
function errorMessage$1(error) {
	return error instanceof Error ? error.message : String(error);
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
function isMissingFile$1(error) {
	return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
/** A per-workspace serialized read/modify/atomic-write store. */
function createIndexStore(storage) {
	const barriers = /* @__PURE__ */ new Map();
	async function load(cwd) {
		try {
			return parseArchiveIndex(await storage.read(cwd));
		} catch (error) {
			if (isMissingFile$1(error)) return emptyArchiveIndex();
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
					try {
						await recoverWriteFailure?.(error);
					} catch (recoveryError) {
						const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
						const reason = error instanceof Error ? error.message : String(error);
						throw new Error(`${reason}（回滚亦失败：${detail}）`);
					}
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
function estimateTokens$1(text) {
	let cjk = 0;
	let other = 0;
	for (const char of String(text ?? "")) if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char)) cjk += 1;
	else other += 1;
	return cjk + Math.ceil(other / 4);
}
/** 估算一个技能在系统提示里的目录成本。 */
function estimateSkillTokens(name, description, whenToUse = "") {
	return estimateTokens$1(`${name} ${description} ${whenToUse}`.trim());
}
//#endregion
//#region lib/types/scanner.js
/**
* 技能根扫描（host 半，纯函数 + 注入的文件访问）。
*
* 为什么需要它：宿主的 skill 注册表**只返回赢家**——同名的落败者只留一行
* `logger.warn`，且 README 明确写着「没有 API 可检查全部被遮蔽的定义」。
* 于是「我改的那个文件到底生不生效」「两个根里哪份在跑」这两个问题，
* 靠注册表永远答不出来。本模块自己扫盘，把被遮蔽者也摆到台面上。
*
* 三件事都在这里算，全部零模型调用：
*   1. 每个技能出现在哪些根、谁是赢家、同名副本内容是否分叉；
*   2. 上下文成本三层：目录（name + 截断后 description）/ 正文 / 资源包；
*   3. 内容指纹——档案页据此知道「建档之后正文被改过」。
*
* 扫描口径与宿主 `dsh-skill-filesystem` 对齐（README「发现流程」）：
* 只看被扫描根的**直接子目录**（内含 `SKILL.md`）或**平铺 `<name>.md`**，
* 刻意不支持嵌套 `**​/SKILL.md`；root 用 rank 升序先到先得，与注册表同规则。
*/
/** 默认根表（rank 与来源名照抄 `dsh-skill-filesystem/README.zh.md` 的优先级表）。 */
function defaultSkillRoots(options) {
	return [
		{
			source: "project-dsh",
			rank: 100,
			path: joinRoot(options.projectRoot, ".dsh", "skills")
		},
		{
			source: "project-agents",
			rank: 200,
			path: joinRoot(options.projectRoot, ".agents", "skills")
		},
		{
			source: "user-dsh",
			rank: 400,
			path: joinRoot(options.dshHome, "skills")
		},
		{
			source: "user-agents",
			rank: 500,
			path: joinRoot(options.agentsHome, "skills")
		}
	];
}
/** POSIX 拼接，只在 host 组装根路径时用；真实路径解析交给注入的 PathFns。 */
function joinRoot(...parts) {
	return parts.map((part, index) => index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, "")).filter((part) => part !== "").join("/");
}
/**
* 目录成本估算：CJK 按 1 token/字，其余按 4 字符/token（cl100k 量级）。
* 与 `tokens.ts` 同口径——那份给 UI，这份给扫描，避免循环依赖此处重复一份。
*/
function estimateTokens(text) {
	let cjk = 0;
	let other = 0;
	for (const char of String(text ?? "")) if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char)) cjk += 1;
	else other += 1;
	return cjk + Math.ceil(other / 4);
}
/**
* 宿主渲染目录时对 description 做的规范化：折叠空白 → 截到上限 + `...`。
* 照抄 `dsh-tool-skill/lib/index.js` 的 `catalogDescription()`。
*/
function catalogDescription(description, maxLength = 500) {
	const normalized = String(description ?? "").replace(/\s+/g, " ").trim();
	return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
* 从 `SKILL.md` 开头解析 frontmatter 里我们要用的标量。
*
* 刻意只做「行内 `key: value`」这一种形态：宿主用完整 YAML 解析并对坏 YAML
* 直接丢弃该技能，而这里的目标是**让坏技能可见**，不是替宿主决定它能不能用。
* 因此解析失败不抛错——拿不到就是空值，浮出到面板上比静默跳过有用。
*/
function parseFrontmatter(text) {
	const fields = {};
	if (typeof text !== "string" || !text.startsWith("---")) return fields;
	const end = text.indexOf("\n---", 3);
	if (end < 0) return fields;
	for (const rawLine of text.slice(3, end).split("\n")) {
		const match = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(rawLine);
		if (match === null) continue;
		const key = match[1];
		let value = match[2].trim();
		if (value === "" || value === ">" || value === "|" || value.startsWith(">") || value.startsWith("|")) continue;
		if (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
		else value = value.replace(/[ \t]+#.*$/, "");
		fields[key] = value.trim();
	}
	return fields;
}
/**
* 扫描全部技能根。
*
* 失败策略：**缺失的根是正常状态**（返回空），**单个条目的读取失败被跳过而不是
* 让整次扫描失败**——一个坏技能不该让面板整个空白。这与宿主
* `dsh-skill-filesystem` 的取舍一致（「已确认缺失的路径属于有效空状态」）。
*/
async function scanSkillRoots(fs, roots, deps) {
	const skills = [];
	const sorted = [...roots].sort((a, b) => a.rank - b.rank || a.source.localeCompare(b.source));
	for (const root of sorted) {
		let rootTarget;
		try {
			rootTarget = await fs.resolve(root.path);
		} catch {
			continue;
		}
		let entries;
		try {
			entries = await fs.listDir(rootTarget);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const scanned = await scanEntry(fs, root, entry, deps);
			if (scanned !== void 0) skills.push(scanned);
		}
	}
	const byName = /* @__PURE__ */ new Map();
	for (const skill of skills) {
		const list = byName.get(skill.name);
		if (list === void 0) byName.set(skill.name, [skill]);
		else list.push(skill);
	}
	for (const list of byName.values()) list.sort((a, b) => a.rank - b.rank || a.source.localeCompare(b.source) || a.entry.localeCompare(b.entry));
	const winners = [...byName.values()].map((list) => list[0]);
	const conflicts = [];
	for (const [name, copies] of byName) {
		if (copies.length < 2) continue;
		conflicts.push({
			name,
			copies,
			identical: copies.every((copy) => copy.hash === copies[0].hash)
		});
	}
	conflicts.sort((a, b) => Number(a.identical) - Number(b.identical) || b.copies.length - a.copies.length || a.name.localeCompare(b.name));
	return {
		skills,
		summary: {
			roots: sorted,
			entries: skills.length,
			winners: winners.length,
			catalogTokens: winners.reduce((total, skill) => total + skill.catalogTokens, 0),
			bodyTokens: winners.reduce((total, skill) => total + skill.bodyTokens, 0),
			assetBytes: winners.reduce((total, skill) => total + skill.assetBytes, 0),
			truncatedDescriptions: winners.filter((skill) => skill.description.replace(/\s+/g, " ").trim().length > 500).map((skill) => skill.name),
			nameMismatches: winners.filter((skill) => skill.dirName !== skill.name).map((skill) => skill.name),
			conflicts
		}
	};
}
async function scanEntry(fs, root, entry, deps) {
	const entryPath = joinRoot(root.path, entry.name);
	let info;
	try {
		info = await fs.stat(entry.target);
	} catch {
		return;
	}
	if (info === void 0) return void 0;
	const isDir = info.type === "directory";
	let skillPath;
	let dirName;
	if (isDir) {
		skillPath = joinRoot(entryPath, "SKILL.md");
		dirName = entry.name;
	} else if (info.type === "file" && entry.name.endsWith(".md")) {
		skillPath = entryPath;
		dirName = entry.name.slice(0, -3);
	} else return;
	let text;
	try {
		text = await fs.readText(await fs.resolve(skillPath));
	} catch {
		return;
	}
	const fields = parseFrontmatter(text);
	const declared = fields["name"] ?? "";
	const name = SKILL_NAME_RE.test(declared) ? declared : dirName;
	const description = fields["description"] ?? "";
	const assets = isDir ? await measureAssets(fs, entry.target) : {
		bytes: 0,
		files: 0
	};
	return {
		name,
		dirName,
		source: root.source,
		rank: root.rank,
		root: root.path,
		entry: entryPath,
		skillPath,
		description,
		bodyBytes: Buffer.byteLength(text, "utf8"),
		hash: deps.hash(text),
		bodyTokens: estimateTokens(text),
		catalogTokens: estimateTokens(`${name} ${catalogDescription(description)}`),
		assetBytes: assets.bytes,
		assetFiles: assets.files
	};
}
/**
* 递归统计 bundle 里正文之外的资源体积。
*
* `ponytail:` 上限——只在**赢家**上调用（由调用方保证），深度封顶 8 层。
* 每个条目都要 `stat` 一次（为拿到跟随软链后的真实类型），所以资源包越大
* 这一趟越贵：本机 `obsidian-second-brain` 有 328 个文件，一次全扫约几十毫秒。
* 若技能数涨到几百、或根目录落在网络盘上，这里要换成带并发上限的遍历。
*/
async function measureAssets(fs, dirTarget, depth = 0) {
	if (depth > 8) return {
		bytes: 0,
		files: 0
	};
	let entries;
	try {
		entries = await fs.listDir(dirTarget);
	} catch {
		return {
			bytes: 0,
			files: 0
		};
	}
	let bytes = 0;
	let files = 0;
	for (const entry of entries) {
		let info;
		try {
			info = await fs.stat(entry.target);
		} catch {
			continue;
		}
		if (info === void 0) continue;
		if (info.type === "directory") {
			const nested = await measureAssets(fs, entry.target, depth + 1);
			bytes += nested.bytes;
			files += nested.files;
			continue;
		}
		if (info.type !== "file") continue;
		if (entry.name === "SKILL.md" && depth === 0) continue;
		files += 1;
		if (typeof info.size === "number") bytes += info.size;
	}
	return {
		bytes,
		files
	};
}
//#endregion
//#region lib/types/report.js
const DEFAULT_REPORT_CONFIG = {
	dataRoot: "reporter",
	briefDir: "brief"
};
/** 归一化插件 config：缺失或非法一律退回默认值。 */
function normalizeReportConfig(raw) {
	const value = raw ?? {};
	const pick = (candidate, fallback) => typeof candidate === "string" && candidate.trim() !== "" ? candidate.trim() : fallback;
	return {
		dataRoot: pick(value.dataRoot, DEFAULT_REPORT_CONFIG.dataRoot),
		briefDir: pick(value.briefDir, DEFAULT_REPORT_CONFIG.briefDir)
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
/** 当周（周一~周日）的 7 个日期；今天不在有数据的周里就回退到最近一个有数据的周。 */
function pickWeek(allDates, today) {
	const week = (day) => {
		const base = /* @__PURE__ */ new Date(`${day}T00:00:00`);
		const weekday = (base.getDay() + 6) % 7;
		const start = new Date(base);
		start.setDate(base.getDate() - weekday);
		return Array.from({ length: 7 }, (_, offset) => {
			const cursor = new Date(start);
			cursor.setDate(start.getDate() + offset);
			return `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
		});
	};
	const current = week(today);
	if (allDates.some((date) => current.includes(date))) return {
		start: current[0],
		end: current[6],
		dates: current,
		fallbackFrom: ""
	};
	const latest = allDates.at(-1);
	if (latest === void 0) return {
		start: current[0],
		end: current[6],
		dates: current,
		fallbackFrom: ""
	};
	const fallback = week(latest);
	return {
		start: fallback[0],
		end: fallback[6],
		dates: fallback,
		fallbackFrom: today
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
		fallbackMonth: currentMonth,
		dates: allDates.filter((date) => date.startsWith(month))
	};
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
function isMissingFile(error) {
	return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Register `/api/report` as part of the manager package's host activation. */
function registerReportApi(ctx, deps) {
	const { webServer, agents, fs, ensureDirectories } = deps;
	const config = deps.config ?? DEFAULT_REPORT_CONFIG;
	function cwdOf(sessionId) {
		if (typeof sessionId !== "string") return "";
		return agents.get(sessionId)?.session.header.cwd ?? "";
	}
	async function readBrief(cwd, date) {
		const relativePath = `${config.dataRoot}/${config.briefDir}/${date}.md`;
		const text = await fs.readText(await fs.resolve(relativePath, { cwd }));
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
	async function readRange(cwd, dates) {
		const days = [];
		const projects = /* @__PURE__ */ new Map();
		const missing = [];
		for (const date of dates) {
			let result;
			try {
				result = await readBrief(cwd, date);
			} catch (error) {
				if (!isMissingFile(error)) missing.push(date);
				continue;
			}
			days.push({
				date,
				count: result.projects.reduce((sum, project) => sum + project.progress.length, 0),
				projects: result.projects.map((project) => project.name)
			});
			for (const project of result.projects) {
				const aggregate = projects.get(project.name) ?? {
					name: project.name,
					purpose: "",
					progress: "",
					todo: [],
					issues: [],
					days: []
				};
				if (aggregate.purpose === "" && project.purpose !== "") aggregate.purpose = project.purpose;
				const latest = project.progress.at(-1);
				if (latest !== void 0) aggregate.progress = latest;
				aggregate.todo = project.todo;
				aggregate.issues = project.issues;
				aggregate.days.push(date);
				projects.set(project.name, aggregate);
			}
		}
		return {
			days,
			projects: [...projects.values()],
			missing
		};
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
		const source = `${config.dataRoot}/${config.briefDir}/`;
		if (cwd === "") return {
			scope: "daily",
			date: today,
			projects: [],
			stats: emptyStats,
			source,
			lastError: "无法确定工作区目录"
		};
		try {
			const pick = pickDailyDate(await listBriefDates(cwd), today);
			if (pick.date === "") return {
				scope: "daily",
				date: today,
				projects: [],
				stats: emptyStats,
				source,
				lastError: ""
			};
			const result = await readBrief(cwd, pick.date);
			return {
				scope: "daily",
				date: result.date,
				projects: result.projects,
				stats: statsOf(result.projects),
				source: result.path,
				lastError: "",
				fallbackFrom: pick.fallbackFrom
			};
		} catch (error) {
			return {
				scope: "daily",
				date: today,
				projects: [],
				stats: emptyStats,
				source,
				lastError: errorMessage(error)
			};
		}
	}
	/** 周报 / 月报共用：给出区间内每天都列出项目，供甘特图与现状卡共用。 */
	async function generateRange(args, scope) {
		const cwd = cwdOf(args?.sessionId);
		const source = `${config.dataRoot}/${config.briefDir}/`;
		const today = localDateKey();
		const empty = {
			scope,
			label: "",
			start: today,
			end: today,
			dates: [],
			days: [],
			projects: [],
			source,
			lastError: ""
		};
		if (cwd === "") return {
			...empty,
			lastError: "无法确定工作区目录"
		};
		let allDates;
		try {
			allDates = await listBriefDates(cwd);
		} catch (error) {
			return {
				...empty,
				lastError: errorMessage(error)
			};
		}
		if (allDates.length === 0) return {
			...empty,
			dates: [],
			lastError: ""
		};
		let dates;
		let label;
		let fallbackFrom = "";
		let start = "";
		let end = "";
		if (scope === "weekly") {
			const pick = pickWeek(allDates, today);
			dates = pick.dates.filter((day) => day <= today);
			start = dates[0] ?? pick.start;
			end = dates.at(-1) ?? pick.end;
			fallbackFrom = pick.fallbackFrom;
			label = `${start} ~ ${end}`;
		} else {
			const pick = pickMonth(allDates, today.slice(0, 7));
			const lastDay = new Date(Number(pick.month.slice(0, 4)), Number(pick.month.slice(5, 7)), 0).getDate();
			dates = Array.from({ length: lastDay }, (_, index) => `${pick.month}-${String(index + 1).padStart(2, "0")}`).filter((day) => day <= today);
			start = dates[0] ?? `${pick.month}-01`;
			end = dates.at(-1) ?? start;
			fallbackFrom = pick.fallbackMonth;
			label = pick.month;
		}
		const range = await readRange(cwd, dates);
		return {
			scope,
			label,
			start,
			end,
			dates,
			days: range.days,
			projects: range.projects,
			source,
			lastError: range.missing.length === 0 ? "" : `以下简报读取失败：${range.missing.join("、")}`,
			fallbackFrom
		};
	}
	const generateWeekly = (args) => generateRange(args, "weekly");
	const generateMonthly = (args) => generateRange(args, "monthly");
	const routeHandler = createRpcRoute({
		handlers: {
			generateDaily,
			generateWeekly,
			generateMonthly
		},
		before: async (args) => {
			if (typeof args?.sessionId !== "string") return;
			const cwd = cwdOf(args.sessionId);
			if (cwd !== "") await ensureDirectories(cwd, args.sessionId, config);
		}
	});
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
function apply(ctx, config) {
	const skills = ctx.get("skills");
	const agents = ctx.get("agents");
	const fs = ctx.get("fs");
	const shell = ctx.get("shell");
	const sandboxPolicy = ctx.get("sandboxPolicy");
	const tools = ctx.get("tools");
	const webServer = ctx.get("webServer");
	if (skills === void 0 || agents === void 0 || fs === void 0 || shell === void 0 || sandboxPolicy === void 0 || tools === void 0 || webServer === void 0) return;
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
	function userMessage(text) {
		return {
			role: "user",
			content: [{
				type: "text",
				text
			}],
			source: { kind: "user" },
			id: randomUUID()
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
			await runShell(moveNoClobberCommand(source, destination), root);
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
			return canonical;
		},
		async read(cwd) {
			const target = await fs.resolve(join(cwd, ".dsh", "skill-manager", "index.json"), { cwd });
			return fs.readText(target);
		},
		async writeAtomic(cwd, value) {
			const dir = join(cwd, ".dsh", "skill-manager");
			const targetPath = join(dir, "index.json");
			const temporaryPath = join(dir, `.index.json.${process.pid}-${randomUUID()}.tmp`);
			await runShell(mkdirCommand(dir), join(cwd, ".dsh"));
			const temporaryTarget = await fs.resolve(temporaryPath, { cwd });
			try {
				await fs.writeText(temporaryTarget, value, void 0, void 0, indexWritePolicy(cwd));
				await runShell(atomicReplaceCommand(temporaryPath, targetPath), dir);
			} catch (error) {
				try {
					await runShell(removeFileCommand(temporaryPath), dir);
				} catch {}
				throw error;
			}
		}
	});
	const readIndex = (cwd) => indexStore.read(cwd);
	/**
	* 插件本身不携带任何信息与记录：工作区里的记录落点由插件启动时建好。
	* 只建目录、不预写文件——空索引文件由第一次真正写入时产生（少一次无谓的重写）。
	* 幂等；失败只记不抛，不拦插件加载。
	*/
	function provisionWorkspace(agent) {
		const { cwd } = agent.session.header;
		if (typeof cwd !== "string" || cwd === "") return;
		(async () => {
			try {
				const policy = sandboxPolicy.resolve({ session: agent.session });
				for (const dir of [join(cwd, ".dsh", "skill-manager"), join(cwd, "reporter", "brief")]) await runShell(mkdirCommand(dir), dir, policy);
			} catch (error) {
				logger?.warn?.(`skill-manager: 记录目录初始化失败（不影响使用，下次再试）：${errorMessage(error)}`);
			}
		})();
	}
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
		onEvent("agent/created", (payload) => {
			const agent = payload?.agent;
			if (agent !== void 0) provisionWorkspace(agent);
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
		name: "skill_dossier",
		description: "读取某个技能的档案（方向 / 使用范围 / 能力边界 / 应用场景 / 调用与实测情况）。技能目录里只有名称和描述，靠它无法判断边界——在决定加载某个技能全文之前，先用本工具读档案；没有档案就用 skill_archive 补一个。",
		parameters: {
			type: "object",
			properties: { name: {
				type: "string",
				description: "技能名（kebab-case），取自技能目录"
			} },
			required: ["name"]
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
			const name = typeof args?.name === "string" ? args.name.trim() : "";
			if (!NAME_RE.test(name)) throw new Error(`无效的技能名：${name}`);
			const agent = exec.agent;
			if (agent === void 0) throw new Error("无法确定当前会话");
			const cwd = agent.session.header.cwd;
			const index = await readIndex(cwd);
			const entry = index.skills[name];
			if (entry === null || entry === void 0 || typeof entry !== "object") return { text: `技能「${name}」还没有档案。先读它的正文再调用 skill_archive 建档，之后这里就有边界与场景可查。` };
			const usage = summarizeUsage(index.usage, Date.now()).find((item) => item.name === name);
			const lines = [
				`技能「${name}」的档案：`,
				`方向：${entry.direction ?? "未标注"}`,
				`使用范围：${entry.useScope ?? "—"}`,
				`能力边界：${entry.boundaries ?? "—"}`,
				`应用场景：${entry.scenarios ?? "—"}`
			];
			if (typeof entry.notes === "string" && entry.notes !== "") lines.push(`备注：${entry.notes}`);
			lines.push(`来源：${entry.origin ?? "未标注"} · 建档 ${entry.updatedAt === void 0 ? "未知" : dayKey(entry.updatedAt)}${entry.reviewedAt === void 0 ? "" : ` · 复审 ${dayKey(entry.reviewedAt)}`}`);
			lines.push(usage === void 0 ? "调用：暂无记录" : `调用：${usage.count} 次 · 活跃 ${usage.activeDays} 天 · 最近 ${dayKey(usage.lastUsedAt)}`);
			if (entry.outcomes !== void 0) {
				const failures = entry.outcomes.failed > 0 ? `，失败 ${entry.outcomes.failed} 次${entry.outcomes.lastError === void 0 || entry.outcomes.lastError === "" ? "" : `（最近一次：${entry.outcomes.lastError}）`}` : "，无失败";
				lines.push(`实测：加载成功 ${entry.outcomes.loaded} 次${failures}`);
			}
			const definition = await skills.get(name, {
				scope: agent,
				cwd
			});
			if (definition !== void 0 && typeof definition.description === "string") lines.push(`注册表描述：${definition.description}`);
			return { text: lines.join("\n") };
		}
	});
	/**
	* 技能根扫描的短缓存。
	*
	* 为什么需要：注册表**只返回赢家**（`dsh-skill` README 写明「没有 API 可检查
	* 全部被遮蔽的定义」），要看见被遮蔽者只能自己扫盘。但面板每次打开都会调
	* `list`，而全量扫描要遍历 100+ 个 bundle、统计 11 MB 资源——实测一次约
	* 数百毫秒。所以给一个 3 秒的短缓存：面板连续刷新不重复扫，人在面板上做完
	* 一次停用/删除后再打开时（>3 秒）自然拿到新盘面。
	*
	* `ponytail:` 天花板——TTL 而非 watcher。磁盘在 3 秒内被外部改动会显示旧值；
	* 真要实时，接 `fs/observed` 或 chokidar 去 invalidate，别把 TTL 调小。
	*/
	const SCAN_TTL_MS = 3e3;
	let scanCache;
	/** 项目根判定与宿主一致：最近的含 `.git` 的祖先，找不到就用 cwd。 */
	async function projectRootOf(cwd) {
		let current = resolve(cwd);
		for (let depth = 0; depth < 64; depth += 1) {
			try {
				await fs.listDir(await fs.resolve(join(current, ".git"), { cwd }));
				return current;
			} catch {}
			const parent = resolve(join(current, ".."));
			if (parent === current) break;
			current = parent;
		}
		return resolve(cwd);
	}
	async function scan(cwd) {
		const projectRoot = await projectRootOf(cwd);
		const cached = scanCache;
		if (cached !== void 0 && cached.projectRoot === projectRoot && Date.now() - cached.at < SCAN_TTL_MS) return cached.result;
		const result = await scanSkillRoots({
			resolve: (path) => fs.resolve(path, { cwd }),
			readText: (target) => fs.readText(target),
			listDir: (target) => fs.listDir(target),
			stat: (target) => fs.stat(target)
		}, defaultSkillRoots({
			projectRoot,
			dshHome: process.env.DSH_HOME ?? join(homedir(), ".dsh"),
			agentsHome: process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents")
		}), { hash: (text) => createHash("sha256").update(text).digest("hex").slice(0, 16) });
		scanCache = {
			at: Date.now(),
			projectRoot,
			result
		};
		return result;
	}
	/** 扫描失败不该让整个面板空白：退化成「没有扫描结果」，并如实带出原因。 */
	async function scanOrNull(cwd) {
		if (cwd === void 0) return {
			scan: null,
			error: null
		};
		try {
			return {
				scan: await scan(cwd),
				error: null
			};
		} catch (error) {
			const message = errorMessage(error);
			logger?.warn?.(`skill-manager: 技能根扫描失败（面板退化为只看注册表）：${message}`);
			return {
				scan: null,
				error: message
			};
		}
	}
	const handlers = {
		async list(args) {
			const sessionId = args?.sessionId;
			const cwd = cwdOf(sessionId);
			const summaries = await skills.list(viewOptions(sessionId));
			const index = await readIndex(cwd);
			const { scan: scanned, error: scanError } = await scanOrNull(cwd);
			const byName = new Map((scanned?.skills ?? []).map((entry) => [entry.name, entry]));
			const copiesOf = new Map((scanned?.summary.conflicts ?? []).map((conflict) => [conflict.name, conflict]));
			let catalogTokens = 0;
			const entries = summaries.map((s) => {
				const approxTokens = estimateSkillTokens(s.name, s.description);
				catalogTokens += approxTokens;
				const local = byName.get(s.name);
				const conflict = copiesOf.get(s.name);
				return {
					name: s.name,
					description: s.description,
					whenToUse: typeof s.whenToUse === "string" ? s.whenToUse : null,
					modelInvocable: s.invocation.modelInvocable === true,
					userInvocable: s.invocation.userInvocable === true,
					source: s.source,
					provider: s.provider,
					approxTokens,
					/** 磁盘事实（来自自扫；注册表查不到时为 null）。 */
					rank: local?.rank ?? null,
					dirName: local?.dirName ?? null,
					bodyBytes: local?.bodyBytes ?? null,
					bodyTokens: local?.bodyTokens ?? null,
					assetBytes: local?.assetBytes ?? null,
					assetFiles: local?.assetFiles ?? null,
					/** 同名副本数（本 root 之外的被遮蔽者）；0 = 没有冲突。 */
					shadowed: conflict === void 0 ? 0 : conflict.copies.length - 1,
					conflictIdentical: conflict?.identical ?? null
				};
			});
			const activeNames = new Set(entries.map((entry) => entry.name));
			const ghosts = Object.keys(index.skills).filter((name) => !activeNames.has(name)).sort();
			return {
				skills: entries,
				index,
				usageHealth: usageWriteFailure,
				catalogTokens,
				scan: scanned?.summary ?? null,
				scanError,
				ghosts,
				shadowedCount: (scanned?.summary.conflicts ?? []).filter((conflict) => conflict.copies.length > 1).length
			};
		},
		async get(args) {
			if (args === null || typeof args !== "object" || typeof args.name !== "string") return null;
			const sessionId = typeof args.sessionId === "string" ? args.sessionId : void 0;
			const skill = await skills.get(args.name, viewOptions(sessionId));
			if (skill === void 0) return null;
			const cwd = cwdOf(sessionId);
			const index = await readIndex(cwd);
			const profile = Object.prototype.hasOwnProperty.call(index.skills, skill.name) ? index.skills[skill.name] : null;
			const { scan: scanned } = await scanOrNull(cwd);
			const local = scanned?.skills.find((entry) => entry.name === skill.name) ?? null;
			const conflict = scanned?.summary.conflicts.find((item) => item.name === skill.name) ?? null;
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
				profile,
				/** 磁盘事实与同名副本（来自自扫；注册表给不出被遮蔽者）。 */
				facts: local === null ? null : {
					rank: local.rank,
					root: local.root,
					dirName: local.dirName,
					bodyBytes: local.bodyBytes,
					bodyTokens: local.bodyTokens,
					catalogTokens: local.catalogTokens,
					assetBytes: local.assetBytes,
					assetFiles: local.assetFiles,
					descriptionLength: local.description.replace(/\s+/g, " ").trim().length
				},
				copies: conflict === null ? [] : conflict.copies.map((copy) => ({
					source: copy.source,
					rank: copy.rank,
					skillPath: copy.skillPath,
					hash: copy.hash,
					bodyBytes: copy.bodyBytes,
					winner: copy === conflict.copies[0]
				}))
			};
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
		/**
		* 同名冲突的完整盘面（含被遮蔽者）。
		*
		* 注册表永远给不出这个：落败者只留一行 logger.warn。这里返回每一组的全部
		* 副本、各自来自哪个根、内容是否一致——`identical === false` 的组是**会让人
		* 改错文件**的那批（改了 rank 400 那份以为生效，其实 rank 100 的赢）。
		*/
		async conflicts(args) {
			const { scan: scanned, error } = await scanOrNull(cwdOf(typeof args?.sessionId === "string" ? args.sessionId : void 0));
			if (scanned === null) return {
				ok: false,
				error: error ?? "无法确定当前工作目录"
			};
			return {
				ok: true,
				summary: scanned.summary,
				conflicts: scanned.summary.conflicts.map((conflict) => ({
					name: conflict.name,
					identical: conflict.identical,
					copies: conflict.copies.map((copy) => ({
						source: copy.source,
						rank: copy.rank,
						root: copy.root,
						dirName: copy.dirName,
						skillPath: copy.skillPath,
						hash: copy.hash,
						bodyBytes: copy.bodyBytes,
						sameName: copy.dirName === copy.name
					}))
				}))
			};
		},
		async uninstall(args) {
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
			const skill = await skills.get(name, viewOptions(sessionId));
			if (skill === void 0) return {
				ok: false,
				error: `技能 "${name}" 不存在`
			};
			const entryInfo = fsEntryOf(skill);
			if (entryInfo === void 0) return {
				ok: false,
				error: "该技能没有文件路径（不是文件系统技能），无法停用"
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
				await runShell(mkdirCommand(trashDir), entryInfo.root);
				await runShell(moveNoClobberCommand(entryInfo.entry, trashedPath), entryInfo.root);
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
			if (!NAME_RE.test(name)) return {
				ok: false,
				error: "无效的技能名"
			};
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
				await runShell(moveNoClobberCommand(trashedPath, originalPath), root);
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
			if (!NAME_RE.test(name)) return {
				ok: false,
				error: "无效的技能名"
			};
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
				if (await realpathWithin(trashedPath, trashDirOf(root)) !== true) rejectIndexOperation("停用记录路径异常，拒绝操作");
				await runShell(removeRecursiveCommand(trashedPath), root);
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
	/** 一步删除 = 停用（移入 trash）+ 彻底删除。复用两步各自的路径校验与失败回滚，
	* 所以 rm 失败时技能还留在 trash 里，仍可重装；不做「直接 rm 源目录」的第二条路径。 */
	handlers.deleteSkill = async (args) => {
		const uninstalled = await handlers.uninstall(args);
		if (uninstalled.ok !== true) return uninstalled;
		return handlers.deleteTrash(args);
	};
	const routeHandler = createRpcRoute({ handlers });
	for (const agent of agents.list?.() ?? []) provisionWorkspace(agent);
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/api/skill-manager",
		handler: routeHandler
	}));
	registerReportApi(ctx, {
		webServer,
		agents,
		fs,
		config: normalizeReportConfig(config?.report),
		ensureDirectories: async (cwd, sessionId, active) => {
			const agent = agents.get(sessionId);
			if (agent === void 0) throw new Error("找不到对应 agent（会话可能已结束）");
			const policy = sandboxPolicy.resolve({ session: agent.session });
			const target = join(cwd, active.dataRoot, active.briefDir);
			await runShell(mkdirCommand(target), target, policy);
		}
	});
}
//#endregion
export { apply, inject, name, realpathWithin };
