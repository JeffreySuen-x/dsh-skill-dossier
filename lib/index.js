import { realpath } from "node:fs/promises";
import * as path from "node:path";
import { isAbsolute, join, relative } from "node:path";
//#region lib/types/match.js
/**
* 技能匹配：给定当前任务的一句话描述，从已建档技能中按确定性评分选出
* 最相关的若干条，把候选收窄到短名单；最终语义判断交给模型。
*
* 评分是朴素的文本启发式：方向关键词命中 + 字符二元组重叠 + 技能名
* 词元命中。它不追求语义精确，只负责「把明显相关的排在前面」。
*/
/** ponytail: 朴素方向关键词表，只覆盖常见触发词，用于给「方向」投票；
* 升级路径是建档时给每个技能产出 embedding，检索时用向量相似度重排。 */
const DIRECTION_KEYWORDS = {
	"开发工程": [
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
		"codebase"
	],
	"前端视觉": [
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
		"响应式"
	],
	"研究分析": [
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
		"前景"
	],
	"内容创作": [
		"写作",
		"文案",
		"脚本",
		"视频",
		"播客",
		"文章",
		"内容",
		"创作",
		"剪辑",
		"稿"
	],
	"知识库": [
		"知识库",
		"笔记",
		"obsidian",
		"vault",
		"wiki",
		"溯源",
		"存档",
		"第二大脑",
		"资料"
	],
	"记忆复盘": [
		"记忆",
		"复盘",
		"总结",
		"摘要",
		"回顾",
		"周报",
		"经验",
		"偏好",
		"会话"
	],
	"元技能": [
		"skill",
		"技能",
		"agent",
		"提示词",
		"prompt",
		"工作流",
		"编排",
		"子代理"
	],
	"工具集成": [
		"工具",
		"集成",
		"mcp",
		"api",
		"插件",
		"自动化",
		"命令行",
		"cli"
	],
	"其他": []
};
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
function detectDirections(query) {
	const q = query.toLowerCase();
	const hits = [];
	for (const [direction, keywords] of Object.entries(DIRECTION_KEYWORDS)) if (keywords.some((k) => q.includes(k.toLowerCase()))) hits.push(direction);
	return hits;
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
	"agents"
];
const DIRECTIONS = [
	"开发工程",
	"前端视觉",
	"研究分析",
	"内容创作",
	"知识库",
	"记忆复盘",
	"元技能",
	"工具集成",
	"其他"
];
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BODY_BYTES = 1024 * 1024;
function apply(ctx) {
	const skills = ctx.get("skills");
	if (skills === void 0) return;
	const agents = ctx.get("agents");
	const fs = ctx.get("fs");
	const shell = ctx.get("shell");
	const sandboxPolicy = ctx.get("sandboxPolicy");
	const tools = ctx.get("tools");
	const webServer = ctx.get("webServer");
	const owned = /* @__PURE__ */ new Map();
	ctx.effect(() => () => {
		for (const dispose of owned.values()) dispose();
		owned.clear();
	});
	function viewOptions(sessionId) {
		if (agents === void 0 || typeof sessionId !== "string") return {};
		const agent = agents.get(sessionId);
		if (agent === void 0) return {};
		return {
			scope: agent,
			cwd: agent.session.header.cwd
		};
	}
	function agentOf(sessionId) {
		if (agents === void 0 || typeof sessionId !== "string") return void 0;
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
	function emptyIndex() {
		return {
			version: 1,
			skills: {},
			trash: {}
		};
	}
	function normalizeIndex(parsed) {
		const p = parsed ?? {};
		return {
			version: 1,
			skills: p.skills !== null && typeof p.skills === "object" ? p.skills : {},
			trash: p.trash !== null && typeof p.trash === "object" ? p.trash : {}
		};
	}
	async function readIndex(cwd) {
		if (fs === void 0 || cwd === void 0) return emptyIndex();
		try {
			const target = await fs.resolve(join(cwd, ".dsh", "skill-manager", "index.json"), { cwd });
			return normalizeIndex(JSON.parse(await fs.readText(target)));
		} catch (error) {
			return emptyIndex();
		}
	}
	async function runShell(command, targetPath) {
		if (shell === void 0) throw new Error("shell 服务不可用");
		const request = { command };
		if (sandboxPolicy !== void 0) {
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
	async function writeIndex(cwd, index) {
		if (fs === void 0) throw new Error("fs 服务不可用");
		if (cwd === void 0) throw new Error("无法确定当前工作目录");
		await runShell(mkdirCommand(join(cwd, ".dsh", "skill-manager"), IS_WINDOWS), join(cwd, ".dsh"));
		const target = await fs.resolve(join(cwd, ".dsh", "skill-manager", "index.json"), { cwd });
		await fs.writeText(target, JSON.stringify(index, null, 2));
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
						description: `方向分类，如：${DIRECTIONS.join("/")}`
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
				if (!(await skills.list(lookup)).some((s) => s.name === name)) throw new Error(`技能 "${name}" 不存在，请先安装或注册`);
				const direction = typeof args.direction === "string" ? args.direction.trim() : "";
				const useScope = typeof args.useScope === "string" ? args.useScope.trim() : "";
				const boundaries = typeof args.boundaries === "string" ? args.boundaries.trim() : "";
				const scenarios = typeof args.scenarios === "string" ? args.scenarios.trim() : "";
				if (direction === "" || useScope === "" || boundaries === "" || scenarios === "") throw new Error("direction/useScope/boundaries/scenarios 均不能为空");
				const origin = args.origin === "self" || args.origin === "external" || args.origin === "system" || args.origin === "unknown" ? args.origin : "unknown";
				const index = await readIndex(cwd);
				index.skills[name] = {
					name,
					direction,
					useScope,
					boundaries,
					scenarios,
					notes: typeof args.notes === "string" && args.notes.trim() !== "" ? args.notes.trim() : void 0,
					origin,
					updatedAt: Date.now()
				};
				await writeIndex(cwd, index);
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
						description: `可选：只在该方向分类内匹配（${DIRECTIONS.join("/")}）`
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
			const prompt = `请为技能「${name}」建档：${typeof skill.path === "string" ? `先读取技能内容（路径：${skill.path}），` : "先用 skill 工具加载该技能，"}分析它属于哪个方向（候选：${DIRECTIONS.join("、")}），然后调用 skill_archive 工具填写：方向 direction、使用范围 useScope、能力边界 boundaries、应用场景 scenarios。`;
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
			const index = await readIndex(cwd);
			const trashDir = trashDirOf(entryInfo.root);
			const trashedPath = join(trashDir, `${name}-${Date.now()}`);
			await runShell(mkdirCommand(trashDir, IS_WINDOWS), entryInfo.root);
			await runShell(moveNoClobberCommand(entryInfo.entry, trashedPath, IS_WINDOWS), entryInfo.root);
			index.trash[name] = {
				name,
				originalPath: entryInfo.entry,
				trashedPath,
				root: entryInfo.root,
				removedAt: Date.now()
			};
			await writeIndex(cwd, index);
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
			const index = await readIndex(cwd);
			const record = index.trash[name];
			if (record === null || typeof record !== "object") return {
				ok: false,
				error: "未找到该技能的停用记录"
			};
			const { trashedPath, originalPath, root } = record;
			if (typeof trashedPath !== "string" || typeof originalPath !== "string" || typeof root !== "string" || trashedPath === "" || originalPath === "" || root === "") return {
				ok: false,
				error: "停用记录损坏"
			};
			if (await realpathWithin(trashedPath, trashDirOf(root)) !== true) return {
				ok: false,
				error: "停用记录路径异常，拒绝操作"
			};
			if (!isWithin(originalPath, root)) return {
				ok: false,
				error: "停用记录路径异常，拒绝操作"
			};
			await runShell(moveNoClobberCommand(trashedPath, originalPath, IS_WINDOWS), root);
			delete index.trash[name];
			await writeIndex(cwd, index);
			return { ok: true };
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
			const index = await readIndex(cwd);
			const record = index.trash[name];
			if (record === null || typeof record !== "object") return {
				ok: false,
				error: "未找到该技能的停用记录"
			};
			const { trashedPath, root } = record;
			if (typeof trashedPath !== "string" || typeof root !== "string" || trashedPath === "" || root === "") return {
				ok: false,
				error: "停用记录损坏"
			};
			if (await realpathWithin(trashedPath, trashDirOf(root)) === false) return {
				ok: false,
				error: "停用记录路径异常，拒绝操作"
			};
			await runShell(removeRecursiveCommand(trashedPath, IS_WINDOWS), root);
			delete index.trash[name];
			await writeIndex(cwd, index);
			return { ok: true };
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
			const index = await readIndex(cwd);
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
			await writeIndex(cwd, index);
			return { ok: true };
		}
	};
	async function readJsonBody(req) {
		let body = "";
		for await (const chunk of req) {
			body += String(chunk);
			if (body.length > MAX_BODY_BYTES) throw new Error("请求体过大");
		}
		return body === "" ? {} : JSON.parse(body);
	}
	function respond(res, status, payload) {
		res.statusCode = status;
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.end(JSON.stringify(payload));
	}
	/** 拒绝跨站请求：浏览器发 `Sec-Fetch-Site: cross-site`，或 `Origin` 与 Host 不符。
	* 本 API 破坏性方法（停用/重装/删除）会 mv/rm，必须挡住 CSRF。 */
	function isCrossSiteRequest(req) {
		const site = req.headers["sec-fetch-site"];
		if (typeof site === "string" && site === "cross-site") return true;
		const origin = req.headers["origin"];
		if (typeof origin !== "string" || origin === "") return false;
		const host = req.headers["host"];
		if (typeof host !== "string" || host === "") return true;
		try {
			return new URL(origin).host !== host;
		} catch {
			return true;
		}
	}
	const routeHandler = async (req, res) => {
		try {
			if (req.method !== "POST") {
				respond(res, 405, { error: "method not allowed" });
				return;
			}
			if (isCrossSiteRequest(req)) {
				respond(res, 403, { error: "跨站请求被拒绝" });
				return;
			}
			let body;
			try {
				body = await readJsonBody(req);
			} catch (error) {
				respond(res, 400, { error: `请求体无效：${String(error)}` });
				return;
			}
			const { method, args } = body ?? {};
			if (typeof method !== "string") {
				respond(res, 400, { error: "缺少 method 字段" });
				return;
			}
			const handler = handlers[method];
			if (handler === void 0) {
				respond(res, 404, { error: `未知方法：${method}` });
				return;
			}
			respond(res, 200, await handler(args));
		} catch (error) {
			respond(res, 500, { error: String(error) });
		}
	};
	if (webServer !== void 0) ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/api/skill-manager",
		handler: routeHandler
	}));
}
//#endregion
export { apply, inject, name, realpathWithin };
