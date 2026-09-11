window.__ModuleLoader__.load({
	id: "dsh-skill-dossier",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/directions.ts
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
		/** 方向名 → 一句话说明（UI 标签提示）。 */
		const DIRECTION_HINTS = Object.fromEntries(DIRECTIONS.map((d) => [d.label, d.description]));
		//#endregion
		//#region src/freshness.ts
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
		//#endregion
		//#region src/usage.ts
		/** 本地时区的 'YYYY-MM-DD' 键。 */
		function dayKey(at) {
			const d = new Date(at);
			const month = String(d.getMonth() + 1).padStart(2, "0");
			const day = String(d.getDate()).padStart(2, "0");
			return `${d.getFullYear()}-${month}-${day}`;
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
		//#endregion
		//#region \0dsh-css:src/client/Panel.module.css.mjs
		const css = ".JKEyxW_wrap[data-theme=light]{--sm-bg:#fff;--sm-bg-2:#f5f5f5;--sm-hover:#ececec;--sm-text:#000;--sm-text-2:#5c5c5c;--sm-border:#d9d9d9;--sm-border-2:#8a8a8a;--sm-fill:#000;--sm-fill-text:#fff;--sm-shadow:0 0 1px 0 #0003, 0 12px 32px 0 #0000002e}.JKEyxW_wrap[data-theme=dark]{--sm-bg:#000;--sm-bg-2:#171717;--sm-hover:#1f1f1f;--sm-text:#fff;--sm-text-2:#a3a3a3;--sm-border:#343434;--sm-border-2:#6b6b6b;--sm-fill:#fff;--sm-fill-text:#000;--sm-shadow:0 0 1px 0 #ffffff40, 0 12px 32px 0 #000c}.JKEyxW_wrap{align-items:center;display:inline-flex;position:relative}.JKEyxW_toggle{border:1px solid var(--sm-border);height:26px;color:var(--sm-text-2);cursor:pointer;background:0 0;border-radius:8px;justify-content:center;align-items:center;padding:0 10px;font-size:12px;line-height:1;display:inline-flex;transform:translateZ(0)}.JKEyxW_toggle:hover{background:var(--sm-hover)}.JKEyxW_toggleActive{color:var(--sm-fill);border-color:var(--sm-fill)}.JKEyxW_panel{z-index:1000;border:1px solid var(--sm-border);background:var(--sm-bg);width:min(620px,90vw);max-height:min(560px,75vh);box-shadow:var(--sm-shadow);color:var(--sm-text);text-align:left;border-radius:12px;flex-direction:column;padding:4px;font-size:13px;display:flex;position:absolute;top:calc(100% + 8px);right:0;overflow:hidden}.JKEyxW_header{align-items:center;gap:6px;padding:6px 8px;display:flex}.JKEyxW_title{flex:auto;font-size:13px;font-weight:600}.JKEyxW_tabs{border-bottom:1px solid var(--sm-border);gap:2px;padding:0 8px 4px;display:flex}.JKEyxW_tab{color:var(--sm-text-2);cursor:pointer;background:0 0;border:none;border-radius:6px 6px 0 0;padding:4px 10px;font-size:12px}.JKEyxW_tab:hover{color:var(--sm-text)}.JKEyxW_tabActive{color:var(--sm-fill);box-shadow:inset 0 -2px 0 var(--sm-fill)}.JKEyxW_search{box-sizing:border-box;border:1px solid var(--sm-border);background:var(--sm-bg-2);width:100%;color:var(--sm-text);border-radius:8px;outline:none;margin:2px 0 4px;padding:7px 10px;font-size:13px}.JKEyxW_list{flex-direction:column;flex:auto;gap:2px;min-height:0;padding:2px 0;display:flex;overflow-y:auto}.JKEyxW_row{cursor:pointer;border-radius:8px;align-items:flex-start;gap:8px;padding:8px 10px;display:flex}.JKEyxW_row:hover{background:var(--sm-hover)}.JKEyxW_rowMain{flex:auto;min-width:0}.JKEyxW_rowName{font-size:13px;font-weight:600}.JKEyxW_rowDesc{color:var(--sm-text-2);text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font-size:12px;overflow:hidden}.JKEyxW_badge{border:1px solid var(--sm-border-2);color:var(--sm-text-2);vertical-align:middle;border-radius:999px;margin-left:6px;padding:0 6px;font-size:10px;font-weight:400;line-height:16px;display:inline-block}.JKEyxW_badgeOk{background:var(--sm-fill);border-color:var(--sm-fill);color:var(--sm-fill-text)}.JKEyxW_btn{border:1px solid var(--sm-border-2);color:var(--sm-text);cursor:pointer;background:0 0;border-radius:6px;flex:none;padding:3px 10px;font-size:12px;line-height:18px}.JKEyxW_btn:hover{background:var(--sm-hover)}.JKEyxW_btn:disabled{opacity:.45;cursor:default}.JKEyxW_btnPrimary{background:var(--sm-fill);border-color:var(--sm-fill);color:var(--sm-fill-text)}.JKEyxW_btnDanger{font-weight:600}.JKEyxW_notice{color:var(--sm-text);padding:4px 10px;font-size:12px;font-weight:600}.JKEyxW_notice:before{content:\"⚠ \"}.JKEyxW_hint{color:var(--sm-text-2);padding:6px 10px;font-size:11px;line-height:1.5}.JKEyxW_footer{border-top:1px solid var(--sm-border);margin-top:4px}.JKEyxW_detailMeta{flex-direction:column;gap:4px;padding:2px 10px 8px;display:flex}.JKEyxW_detailDesc{font-size:12px}.JKEyxW_detailWhen{color:var(--sm-text-2);font-size:12px}.JKEyxW_detailSrc{color:var(--sm-text-2);word-break:break-all;font-size:11px}.JKEyxW_detailActions{flex-wrap:wrap;gap:6px;padding:2px 10px 8px;display:flex}.JKEyxW_pre{border:1px solid var(--sm-border);background:var(--sm-bg-2);white-space:pre-wrap;border-radius:8px;flex:auto;min-height:0;margin:0 10px 10px;padding:10px;font-size:12px;line-height:1.6;overflow:auto}.JKEyxW_form{flex-direction:column;gap:8px;min-height:0;padding:2px 10px 10px;display:flex;overflow-y:auto}.JKEyxW_input{box-sizing:border-box;border:1px solid var(--sm-border);background:var(--sm-bg-2);width:100%;color:var(--sm-text);border-radius:8px;outline:none;padding:7px 10px;font-size:13px}.JKEyxW_textarea{box-sizing:border-box;border:1px solid var(--sm-border);background:var(--sm-bg-2);width:100%;color:var(--sm-text);resize:vertical;border-radius:8px;outline:none;padding:8px 10px;font-family:inherit;font-size:12px;line-height:1.6}.JKEyxW_formRow{cursor:pointer;align-items:center;gap:6px;font-size:12px;display:flex}.JKEyxW_chips{flex-wrap:wrap;gap:4px;padding:6px 10px;display:flex}.JKEyxW_chip{border:1px solid var(--sm-border-2);color:var(--sm-text-2);cursor:pointer;background:0 0;border-radius:999px;padding:2px 8px;font-size:11px;line-height:16px}.JKEyxW_chip:hover{color:var(--sm-text)}.JKEyxW_chipActive{color:var(--sm-fill);border-color:var(--sm-fill);background:var(--sm-bg-2)}.JKEyxW_section{flex-direction:column;gap:6px;min-height:0;padding:4px 10px 8px;display:flex;overflow-y:auto}.JKEyxW_sectionTitle{color:var(--sm-text-2);letter-spacing:.4px;font-size:11px;font-weight:600}.JKEyxW_card{border:1px solid var(--sm-border);border-radius:8px;flex-direction:column;gap:4px;padding:8px 10px;display:flex}.JKEyxW_cardHead{flex-wrap:wrap;align-items:center;gap:4px;display:flex}.JKEyxW_profile{border:1px solid var(--sm-border);background:var(--sm-bg-2);border-radius:8px;flex-direction:column;gap:4px;padding:8px 10px;display:flex}.JKEyxW_profileRow{font-size:12px;line-height:1.6}.JKEyxW_originChips{flex-wrap:wrap;align-items:center;gap:3px;display:inline-flex}.JKEyxW_originSmall .JKEyxW_originChip{padding:0 6px;font-size:10px;line-height:15px}.JKEyxW_originChip{border:1px solid var(--sm-border-2);color:var(--sm-text-2);cursor:pointer;background:0 0;border-radius:999px;padding:1px 7px;font-size:11px;line-height:16px}.JKEyxW_originChip:hover{color:var(--sm-text)}.JKEyxW_originChipActive{color:var(--sm-fill);border-color:var(--sm-fill);background:var(--sm-bg-2)}.JKEyxW_originChip:disabled{opacity:.45;cursor:default}.JKEyxW_reportBody{flex-direction:column;flex:auto;gap:8px;min-height:0;padding:6px 10px 10px;display:flex;overflow-y:auto}.JKEyxW_reportActions{flex-wrap:wrap;gap:6px;display:flex}.JKEyxW_reportViewBtn{border:1px solid var(--sm-border);height:26px;color:var(--sm-text-2);cursor:pointer;background:0 0;border-radius:6px;padding:0 10px;font-size:12px;line-height:1}.JKEyxW_reportViewBtn:hover{color:var(--sm-text);background:var(--sm-hover)}.JKEyxW_reportViewBtnActive{background:var(--sm-fill);border-color:var(--sm-fill);color:var(--sm-fill-text)}.JKEyxW_reportViewBtn:disabled{opacity:.5;cursor:default}.JKEyxW_reportSec{flex-direction:column;gap:6px;display:flex}.JKEyxW_reportProject{border:1px solid var(--sm-border);border-radius:8px;flex-direction:column;gap:2px;padding:8px 10px;font-size:12px;line-height:1.6;display:flex}.JKEyxW_reportProject strong{font-size:13px}.JKEyxW_reportProject ul{margin:2px 0 6px;padding-left:18px}.JKEyxW_reportTable{border-collapse:collapse;width:100%;font-size:11.5px;line-height:1.5}.JKEyxW_reportTable th,.JKEyxW_reportTable td{border:1px solid var(--sm-border);text-align:left;vertical-align:top;word-break:break-word;padding:4px 7px}.JKEyxW_reportTable th{background:var(--sm-bg-2);font-weight:700}.JKEyxW_muted{color:var(--sm-text-2)}.JKEyxW_reportNotice{border:1px solid var(--sm-border-2);color:var(--sm-text);word-break:break-all;border-radius:8px;padding:6px 10px;font-size:12px}";
		const tagId = "dsh-skill-dossier/Panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skill-dossier";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Panel_module_css_default = {
			"badge": "JKEyxW_badge",
			"badgeOk": "JKEyxW_badgeOk",
			"btn": "JKEyxW_btn",
			"btnDanger": "JKEyxW_btnDanger",
			"btnPrimary": "JKEyxW_btnPrimary",
			"card": "JKEyxW_card",
			"cardHead": "JKEyxW_cardHead",
			"chip": "JKEyxW_chip",
			"chipActive": "JKEyxW_chipActive",
			"chips": "JKEyxW_chips",
			"detailActions": "JKEyxW_detailActions",
			"detailDesc": "JKEyxW_detailDesc",
			"detailMeta": "JKEyxW_detailMeta",
			"detailSrc": "JKEyxW_detailSrc",
			"detailWhen": "JKEyxW_detailWhen",
			"footer": "JKEyxW_footer",
			"form": "JKEyxW_form",
			"formRow": "JKEyxW_formRow",
			"header": "JKEyxW_header",
			"hint": "JKEyxW_hint",
			"input": "JKEyxW_input",
			"list": "JKEyxW_list",
			"muted": "JKEyxW_muted",
			"notice": "JKEyxW_notice",
			"originChip": "JKEyxW_originChip",
			"originChipActive": "JKEyxW_originChipActive",
			"originChips": "JKEyxW_originChips",
			"originSmall": "JKEyxW_originSmall",
			"panel": "JKEyxW_panel",
			"pre": "JKEyxW_pre",
			"profile": "JKEyxW_profile",
			"profileRow": "JKEyxW_profileRow",
			"reportActions": "JKEyxW_reportActions",
			"reportBody": "JKEyxW_reportBody",
			"reportNotice": "JKEyxW_reportNotice",
			"reportProject": "JKEyxW_reportProject",
			"reportSec": "JKEyxW_reportSec",
			"reportTable": "JKEyxW_reportTable",
			"reportViewBtn": "JKEyxW_reportViewBtn",
			"reportViewBtnActive": "JKEyxW_reportViewBtnActive",
			"row": "JKEyxW_row",
			"rowDesc": "JKEyxW_rowDesc",
			"rowMain": "JKEyxW_rowMain",
			"rowName": "JKEyxW_rowName",
			"search": "JKEyxW_search",
			"section": "JKEyxW_section",
			"sectionTitle": "JKEyxW_sectionTitle",
			"tab": "JKEyxW_tab",
			"tabActive": "JKEyxW_tabActive",
			"tabs": "JKEyxW_tabs",
			"textarea": "JKEyxW_textarea",
			"title": "JKEyxW_title",
			"toggle": "JKEyxW_toggle",
			"toggleActive": "JKEyxW_toggleActive",
			"wrap": "JKEyxW_wrap"
		};
		//#endregion
		//#region src/client/report-state.ts
		/** Convert a report payload's structured failure into UI state. */
		function reportFailureMessage(payload) {
			return typeof payload.lastError === "string" ? payload.lastError : "";
		}
		//#endregion
		//#region src/client/Panel.tsx
		/**
		* Skills 管理面板：目录浏览/搜索/详情/调用/建档，档案页（方向筛选、
		* 未建档清单、档案卡片、停用/重装/删除），以及会话级临时技能的注册与卸载。
		* 组件自包含（按钮 + 弹层），无宿主 hook 依赖。
		*/
		const FS_SOURCES = [
			"project-dsh",
			"project-agents",
			"user-dsh",
			"user-agents",
			"custom"
		];
		const ORIGIN_LABELS = {
			self: "自创",
			external: "外来",
			system: "系统",
			unknown: "未标注"
		};
		const ORIGIN_KEYS = [
			"self",
			"external",
			"system",
			"unknown"
		];
		/** 两个 host 路由共用一个 JSON-RPC 客户端。 */
		async function rpc(path, method, args) {
			const res = await fetch(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					method,
					args
				})
			});
			let data = null;
			try {
				data = await res.json();
			} catch {
				data = null;
			}
			if (!res.ok || data === null) throw new Error(!res.ok && data !== null && typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
			return data;
		}
		const MANAGER_API = "/api/skill-manager";
		const REPORT_API = "/api/report";
		function normalizeList(res) {
			const r = res ?? {};
			const idx = r.index ?? {};
			return {
				skills: Array.isArray(r.skills) ? r.skills : [],
				index: {
					skills: idx.skills !== null && typeof idx.skills === "object" ? idx.skills : {},
					trash: idx.trash !== null && typeof idx.trash === "object" ? idx.trash : {},
					usage: idx.usage !== null && typeof idx.usage === "object" ? idx.usage : {}
				},
				usageHealth: typeof r.usageHealth === "string" ? r.usageHealth : null,
				catalogTokens: typeof r.catalogTokens === "number" ? r.catalogTokens : 0
			};
		}
		/** 档案卡片上的一行调用统计（并入档案页，替代原「统计」独立板块）。 */
		function usageLine(summary) {
			if (summary === void 0) return "调用记录：暂无";
			const when = summary.lastUsedDaysAgo === 0 ? "今天" : `${summary.lastUsedDaysAgo} 天前`;
			return `调用记录：${summary.count} 次 · 活跃 ${summary.activeDays} 天 · 最近 ${dayKey(summary.lastUsedAt)}（${when}）`;
		}
		function Panel({ sessionId, prependDraft, themeScheme }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [scheme, setScheme] = (0, react.useState)(() => themeScheme.get());
			const [data, setData] = (0, react.useState)(null);
			const [query, setQuery] = (0, react.useState)("");
			const [tab, setTab] = (0, react.useState)("skills");
			const [view, setView] = (0, react.useState)("list");
			const [detail, setDetail] = (0, react.useState)(null);
			const [filter, setFilter] = (0, react.useState)("all");
			const [confirmName, setConfirmName] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [form, setForm] = (0, react.useState)({
				name: "",
				description: "",
				whenToUse: "",
				content: "",
				modelInvocable: true,
				userInvocable: true
			});
			const [reportView, setReportView] = (0, react.useState)("daily");
			const [reportData, setReportData] = (0, react.useState)(null);
			const [reportLoading, setReportLoading] = (0, react.useState)(false);
			const [reportError, setReportError] = (0, react.useState)("");
			const reload = () => {
				setData(null);
				rpc(MANAGER_API, "list", { sessionId }).then((res) => setData(normalizeList(res))).catch((error) => {
					setData({
						skills: [],
						index: {
							skills: {},
							trash: {},
							usage: {}
						}
					});
					setNotice(String(error));
				});
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				let cancelled = false;
				setData(null);
				rpc(MANAGER_API, "list", { sessionId }).then((res) => {
					if (!cancelled) setData(normalizeList(res));
				}).catch((error) => {
					if (!cancelled) {
						setData({
							skills: [],
							index: {
								skills: {},
								trash: {},
								usage: {}
							}
						});
						setNotice(String(error));
					}
				});
				return () => {
					cancelled = true;
				};
			}, [open, sessionId]);
			(0, react.useEffect)(() => themeScheme.subscribe(setScheme), [themeScheme]);
			const profiles = data?.index.skills ?? {};
			const trash = data?.index.trash ?? {};
			const usage = data?.index.usage ?? {};
			const usageHealth = data?.usageHealth ?? null;
			const catalogTokens = data?.catalogTokens ?? 0;
			const skills = data?.skills ?? null;
			const tokensByName = new Map((skills ?? []).map((s) => [s.name, s.approxTokens ?? 0]));
			const sourceByName = new Map((skills ?? []).map((s) => [s.name, s.source]));
			const activeNames = skills === null ? null : new Set(skills.map((s) => s.name));
			const hasProfile = (name) => Object.prototype.hasOwnProperty.call(profiles, name);
			const isProfiled = (name) => {
				const p = profiles[name];
				return p !== void 0 && typeof p.direction === "string" && p.direction !== "";
			};
			const originKeyOfName = (name, owned, source) => {
				const entry = profiles[name];
				if (entry !== void 0 && entry.origin !== void 0) return entry.origin;
				if (owned) return "self";
				if (source === "bundled") return "system";
			};
			const originOf = (s) => {
				const key = originKeyOfName(s.name, s.owned, s.source) ?? "unknown";
				return {
					key,
					label: ORIGIN_LABELS[key]
				};
			};
			const OriginChips = ({ name, value, small }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `${Panel_module_css_default.originChips}${small === true ? ` ${Panel_module_css_default.originSmall}` : ""}`,
				onClick: (e) => e.stopPropagation(),
				title: "标注来源：自创 / 外来下载 / 系统内置 / 未标注",
				children: ORIGIN_KEYS.map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${Panel_module_css_default.originChip}${value === key ? ` ${Panel_module_css_default.originChipActive}` : ""}`,
					disabled: busy,
					onClick: () => doCall("setOrigin", {
						name,
						origin: key,
						sessionId
					}),
					children: ORIGIN_LABELS[key]
				}, key))
			});
			const doCall = (method, arg, onOk) => {
				setBusy(true);
				setNotice("");
				rpc(MANAGER_API, method, arg).then((res) => {
					setBusy(false);
					if (res !== null && typeof res === "object" && res.ok === true) {
						onOk?.();
						reload();
					} else setNotice(res !== null && typeof res === "object" && typeof res.error === "string" ? res.error : "操作失败");
				}).catch((error) => {
					setBusy(false);
					setNotice(String(error));
				});
			};
			const invoke = (name) => {
				prependDraft(`/${name} `);
				setOpen(false);
			};
			const ingest = (name) => doCall("ingest", {
				name,
				sessionId
			}, () => setOpen(false));
			const uninstall = (name) => doCall("uninstall", {
				name,
				sessionId
			});
			const deleteSkill = (name) => {
				setConfirmName(null);
				doCall("deleteSkill", {
					name,
					sessionId
				});
			};
			/** 破坏性动作 + 二次确认。confirmName 是单值，所以同一时刻只有一个动作在确认态。 */
			const DangerDelete = ({ name, source }) => confirmName === name ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
				label: "确认删除",
				kind: "danger",
				onClick: (e) => {
					e.stopPropagation();
					deleteSkill(name);
				}
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
				label: "取消",
				onClick: (e) => {
					e.stopPropagation();
					setConfirmName(null);
				}
			})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
				label: "删除",
				kind: "danger",
				title: `把 ${name} 移入 trash 后彻底删除，不可恢复（来源：${source}）`,
				onClick: (e) => {
					e.stopPropagation();
					setConfirmName(name);
				}
			});
			const reinstall = (name) => doCall("reinstall", {
				name,
				sessionId
			});
			const deleteTrash = (name) => {
				setConfirmName(null);
				doCall("deleteTrash", {
					name,
					sessionId
				});
			};
			const removeSkill = (name) => doCall("unregister", {
				name,
				sessionId
			});
			const openDetail = (name) => {
				setView("detail");
				setDetail(null);
				setNotice("");
				rpc(MANAGER_API, "get", {
					name,
					sessionId
				}).then((res) => setDetail(res)).catch((error) => {
					setDetail(null);
					setNotice(String(error));
				});
			};
			const submitCreate = () => {
				const name = form.name.trim();
				if (form.description.trim() === "") {
					setNotice("描述不能为空");
					return;
				}
				if (form.content.trim() === "") {
					setNotice("内容不能为空");
					return;
				}
				setBusy(true);
				setNotice("");
				rpc(MANAGER_API, "register", {
					sessionId,
					name,
					description: form.description.trim(),
					whenToUse: form.whenToUse.trim(),
					content: form.content,
					modelInvocable: form.modelInvocable,
					userInvocable: form.userInvocable
				}).then((res) => {
					setBusy(false);
					if (res !== null && typeof res === "object" && res.ok === true) {
						setView("list");
						setForm({
							name: "",
							description: "",
							whenToUse: "",
							content: "",
							modelInvocable: true,
							userInvocable: true
						});
						reload();
					} else setNotice(res !== null && typeof res === "object" && typeof res.error === "string" ? res.error : "注册失败");
				}).catch((error) => {
					setBusy(false);
					setNotice(String(error));
				});
			};
			const onKeyDown = (e) => {
				if (e.key === "Escape") setOpen(false);
			};
			const Btn = ({ label, onClick, kind, title, disabled }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: `${Panel_module_css_default.btn}${kind === "primary" ? ` ${Panel_module_css_default.btnPrimary}` : ""}${kind === "danger" ? ` ${Panel_module_css_default.btnDanger}` : ""}`,
				disabled: busy || disabled === true,
				title,
				onClick,
				children: label
			});
			const row = (s) => {
				const profiled = isProfiled(s.name);
				const fsSkill = FS_SOURCES.includes(s.source);
				const origin = originOf(s);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Panel_module_css_default.row,
					onClick: () => openDetail(s.name),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.rowMain,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.rowName,
								children: [
									s.name,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${Panel_module_css_default.badge}${origin.key === "self" || origin.key === "system" ? ` ${Panel_module_css_default.badgeOk}` : ""}`,
										children: origin.label
									}),
									profiled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${Panel_module_css_default.badge} ${Panel_module_css_default.badgeOk}`,
										children: profiles[s.name]?.direction
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Panel_module_css_default.badge,
										children: "未建档"
									}),
									s.userInvocable ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Panel_module_css_default.badge,
										children: "禁用户调用"
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.rowDesc,
								children: s.description
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							label: "调用",
							kind: "primary",
							disabled: !s.userInvocable,
							title: s.userInvocable ? `把 /${s.name} 填入输入框，再补充你的需求` : "该技能不允许用户显式调用",
							onClick: (e) => {
								e.stopPropagation();
								invoke(s.name);
							}
						}),
						profiled || !fsSkill ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							label: "建档",
							onClick: (e) => {
								e.stopPropagation();
								ingest(s.name);
							}
						}),
						s.owned ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							label: "卸载",
							kind: "danger",
							onClick: (e) => {
								e.stopPropagation();
								removeSkill(s.name);
							}
						}) : fsSkill ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							label: "停用",
							title: "移入 trash，可重装",
							onClick: (e) => {
								e.stopPropagation();
								uninstall(s.name);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DangerDelete, {
							name: s.name,
							source: s.source
						})] }) : null
					]
				}, s.name);
			};
			const listBody = () => {
				const q = query.trim().toLowerCase();
				const filtered = skills === null ? null : skills.filter((s) => {
					if (q === "") return true;
					return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: Panel_module_css_default.search,
						type: "text",
						placeholder: "搜索名称或描述…",
						value: query,
						autoFocus: true,
						onChange: (e) => setQuery(e.target.value)
					}),
					skills === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Panel_module_css_default.hint,
						children: "加载中…"
					}) : filtered !== null && filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Panel_module_css_default.hint,
						children: skills.length === 0 ? "当前没有可用技能" : "没有匹配的技能"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Panel_module_css_default.list,
						children: (filtered ?? []).map(row)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.section,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.sectionTitle,
								children: "临时技能（仅当前会话）"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.hint,
								children: "会话级试写：注册的技能只在本会话可见，会话结束自动回收，不落盘、不进档案。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.detailActions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: "新建临时技能",
									onClick: () => {
										setNotice("");
										setView("create");
									}
								})
							})
						]
					})
				] });
			};
			const detailBody = () => {
				if (detail === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.hint,
					children: "加载中…"
				});
				const d = detail;
				const p = d.profile;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.detailMeta,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.rowName,
								children: [
									d.name,
									d.owned ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Panel_module_css_default.badge,
										children: "临时"
									}) : null,
									p !== null && p.direction !== void 0 && p.direction !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${Panel_module_css_default.badge} ${Panel_module_css_default.badgeOk}`,
										children: p.direction
									}) : null,
									d.modelInvocable ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Panel_module_css_default.badge,
										children: "仅用户调用"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OriginChips, {
								name: d.name,
								value: originKeyOfName(d.name, d.owned, d.source)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.detailDesc,
								children: d.description
							}),
							d.whenToUse !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.detailWhen,
								children: ["适用：", d.whenToUse]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.detailSrc,
								children: [
									"来源：",
									d.source,
									" · provider: ",
									d.provider,
									d.path !== null ? ` · ${d.path}` : ""
								]
							}),
							p !== null && p.direction !== void 0 && p.direction !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.profile,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Panel_module_css_default.profileRow,
										children: ["使用范围：", p.useScope]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Panel_module_css_default.profileRow,
										children: ["能力边界：", p.boundaries]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Panel_module_css_default.profileRow,
										children: ["应用场景：", p.scenarios]
									})
								]
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.detailActions,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								label: "← 返回",
								onClick: () => {
									setView("list");
									setDetail(null);
								}
							}),
							d.userInvocable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								label: "调用",
								kind: "primary",
								onClick: () => invoke(d.name)
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								label: p !== null ? "重新建档" : "建档",
								onClick: () => ingest(d.name)
							}),
							d.owned ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								label: "卸载",
								kind: "danger",
								onClick: () => removeSkill(d.name)
							}) : FS_SOURCES.includes(d.source) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								label: "停用",
								onClick: () => uninstall(d.name)
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: Panel_module_css_default.pre,
						children: d.content
					})
				] });
			};
			const createBody = () => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Panel_module_css_default.form,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: Panel_module_css_default.input,
						type: "text",
						placeholder: "名称（kebab-case，如 my-skill）",
						value: form.name,
						autoFocus: true,
						onChange: (e) => setForm({
							...form,
							name: e.target.value
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: Panel_module_css_default.input,
						type: "text",
						placeholder: "描述（给模型的触发说明）",
						value: form.description,
						onChange: (e) => setForm({
							...form,
							description: e.target.value
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: Panel_module_css_default.input,
						type: "text",
						placeholder: "whenToUse（可选）",
						value: form.whenToUse,
						onChange: (e) => setForm({
							...form,
							whenToUse: e.target.value
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: Panel_module_css_default.formRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: form.modelInvocable,
							onChange: (e) => setForm({
								...form,
								modelInvocable: e.target.checked
							})
						}), "模型可调用"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: Panel_module_css_default.formRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: form.userInvocable,
							onChange: (e) => setForm({
								...form,
								userInvocable: e.target.checked
							})
						}), "用户可调用（/name 手势）"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: Panel_module_css_default.textarea,
						rows: 10,
						placeholder: "技能正文（markdown）",
						value: form.content,
						onChange: (e) => setForm({
							...form,
							content: e.target.value
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.detailActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							label: busy ? "保存中…" : "注册",
							kind: "primary",
							onClick: submitCreate
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							label: "取消",
							onClick: () => {
								setNotice("");
								setView("list");
							}
						})]
					})
				]
			});
			const archiveBody = () => {
				const profiledNames = Object.keys(profiles);
				const unprofiled = skills === null ? [] : skills.filter((s) => !hasProfile(s.name));
				const trashedNames = Object.keys(trash);
				const usageByName = new Map(summarizeUsage(usage, Date.now()).map((entry) => [entry.name, entry]));
				const needsReview = reviewCandidates(profiles, usage, Date.now(), 5);
				const directionSet = new Set(DIRECTION_LABELS);
				for (const n of profiledNames) {
					const d = profiles[n]?.direction;
					if (typeof d === "string" && d !== "") directionSet.add(d);
				}
				const directionOptions = Array.from(directionSet);
				const chip = (label, value, count, title) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: `${Panel_module_css_default.chip}${filter === value ? ` ${Panel_module_css_default.chipActive}` : ""}`,
					title,
					onClick: () => setFilter(value),
					children: [label, count !== void 0 ? ` ${count}` : ""]
				}, value);
				const profileCard = (name) => {
					const p = profiles[name];
					if (p === void 0) return null;
					const active = activeNames !== null && activeNames.has(name);
					const trashed = Object.prototype.hasOwnProperty.call(trash, name);
					const origin = p.origin ?? "unknown";
					const profiled = p.direction !== void 0 && p.direction !== "";
					if (!(filter === "all" || filter === "active" && active || filter === "trashed" && trashed || filter === p.direction || filter === origin)) return null;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.cardHead,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Panel_module_css_default.rowName,
										children: name
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${Panel_module_css_default.badge}${origin === "self" || origin === "system" ? ` ${Panel_module_css_default.badgeOk}` : ""}`,
										children: ORIGIN_LABELS[origin]
									}),
									profiled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${Panel_module_css_default.badge} ${Panel_module_css_default.badgeOk}`,
										title: DIRECTION_HINTS[p.direction ?? ""],
										children: p.direction
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Panel_module_css_default.badge,
										children: "未建档"
									}),
									trashed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Panel_module_css_default.badge,
										children: "已停用"
									}) : active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${Panel_module_css_default.badge} ${Panel_module_css_default.badgeOk}`,
										children: "启用中"
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: Panel_module_css_default.badge,
										children: "不在目录"
									})
								]
							}),
							profiled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Panel_module_css_default.profileRow,
									children: ["使用范围：", p.useScope]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Panel_module_css_default.profileRow,
									children: ["能力边界：", p.boundaries]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Panel_module_css_default.profileRow,
									children: ["应用场景：", p.scenarios]
								}),
								p.notes !== void 0 && p.notes !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Panel_module_css_default.profileRow,
									children: ["备注：", p.notes]
								}) : null
							] }) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.profileRow,
								children: usageLine(usageByName.get(name))
							}),
							tokensByName.has(name) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.profileRow,
								children: [
									"目录成本：≈",
									tokensByName.get(name),
									" tokens（名称+描述常驻系统提示）"
								]
							}) : null,
							p.outcomes !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.profileRow,
								children: [
									"实测：加载成功 ",
									p.outcomes.loaded,
									" 次",
									p.outcomes.failed > 0 ? ` · 失败 ${p.outcomes.failed} 次${p.outcomes.lastError !== void 0 && p.outcomes.lastError !== "" ? `（${p.outcomes.lastError}）` : ""}` : ""
								]
							}) : null,
							p.evaluation !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.profileRow,
								children: [
									"评测：",
									p.evaluation.conclusion,
									p.evaluation.score !== null ? ` · ${p.evaluation.score}/10` : "",
									p.evaluation.baselineDelta !== null && p.evaluation.baselineDelta !== "" ? ` · ${p.evaluation.baselineDelta}` : ""
								]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OriginChips, {
								name,
								value: p.origin,
								small: true
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.detailActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: profiled ? "重新建档" : "识别建档",
									...profiled ? {} : { kind: "primary" },
									onClick: () => ingest(name)
								}), trashed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: "重装",
									kind: "primary",
									onClick: () => reinstall(name)
								}), confirmName === name ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: "确认删除",
									kind: "danger",
									onClick: () => deleteTrash(name)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: "取消",
									onClick: () => setConfirmName(null)
								})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: "删除",
									kind: "danger",
									onClick: () => setConfirmName(name)
								})] }) : active ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: "停用",
									title: "移入 trash，可重装",
									onClick: () => uninstall(name)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DangerDelete, {
									name,
									source: sourceByName.get(name) ?? "文件系统"
								})] }) : null]
							})
						]
					}, name);
				};
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.chips,
						children: [
							chip("全部", "all"),
							chip("未建档", "unprofiled", unprofiled.length),
							chip("启用中", "active"),
							chip("已停用", "trashed", trashedNames.length),
							directionOptions.map((d) => chip(d, d, void 0, DIRECTION_HINTS[d])),
							ORIGIN_KEYS.map((k) => chip(ORIGIN_LABELS[k], k))
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.hint,
						children: [
							"目录成本合计 ≈",
							catalogTokens,
							" tokens：",
							profiledNames.length,
							" 条档案对应的技能目录会整段进系统提示，越靠前的技能越占预算。"
						]
					}),
					needsReview.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.section,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.sectionTitle,
								children: [
									"待复审（",
									needsReview.length,
									"）"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.hint,
								children: "按「易变方向 + 长期未用 + 久未复审」排序。复审结论可用 record_eval 写回档案。"
							}),
							needsReview.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Panel_module_css_default.rowMain,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Panel_module_css_default.rowName,
										children: [entry.name, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: Panel_module_css_default.badge,
											children: entry.direction
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: Panel_module_css_default.rowDesc,
										children: entry.reasons.join("、")
									})]
								})
							}, entry.name))
						]
					}) : null,
					(filter === "all" || filter === "unprofiled") && unprofiled.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.section,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.sectionTitle,
							children: [
								"新加入/未建档（",
								unprofiled.length,
								"）"
							]
						}), unprofiled.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.rowMain,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: Panel_module_css_default.rowName,
									children: s.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: Panel_module_css_default.rowDesc,
									children: s.description
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								label: "识别建档",
								kind: "primary",
								onClick: () => ingest(s.name)
							})]
						}, s.name))]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.section,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.sectionTitle,
							children: [
								"技能档案（",
								profiledNames.length,
								"）"
							]
						}), profiledNames.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Panel_module_css_default.hint,
							children: "还没有档案。在「技能」页点击「建档」，或直接让 AI 用 skill_archive 工具建档。"
						}) : profiledNames.map(profileCard)]
					}),
					trashedNames.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Panel_module_css_default.hint,
						children: "已停用技能保存在 trash 目录，可重装或彻底删除。"
					}) : null
				] });
			};
			const reportRpc = (method, args) => rpc(REPORT_API, method, args);
			const loadReport = (view = reportView) => {
				setReportLoading(true);
				setReportError("");
				setReportData(null);
				reportRpc(view === "monthly" ? "generateMonthly" : "generateDaily", { sessionId }).then((data) => {
					const failure = reportFailureMessage(data);
					if (failure !== "") {
						setReportError(failure);
						setReportData(null);
					} else setReportData(data);
					setReportLoading(false);
				}).catch((error) => {
					setReportError(String(error));
					setReportLoading(false);
				});
			};
			const reportItems = (items, empty) => {
				const list = items ?? [];
				if (list.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
					className: Panel_module_css_default.muted,
					children: empty
				});
				return list.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: item }, index));
			};
			const reportProjects = (projects) => {
				const list = projects ?? [];
				if (list.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.hint,
					children: "暂无记录。按 brief skill 维护 reporter/brief/YYYY-MM-DD.md，这里会自动汇总。"
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Panel_module_css_default.reportSec,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.sectionTitle,
						children: [
							"进行项目（",
							list.length,
							"）"
						]
					}), list.map((project, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.reportProject,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
								index + 1,
								"、",
								project.name
							] }),
							project.purpose ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["作用：", project.purpose] }) : null,
							project.impl ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["实现：", project.impl] }) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "今日进度：" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: reportItems(project.progress, "（暂无）") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "待办：" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: reportItems(project.todo, "（无）") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "问题：" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: reportItems(project.issues, "（无）") })
						]
					}, `${project.name}-${index}`))]
				});
			};
			const reportBody = () => {
				const data = reportData;
				let content = null;
				if (reportLoading) content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.hint,
					children: "读取 brief…"
				});
				else if (data !== null) {
					if (reportView === "monthly" && "days" in data) {
						const monthly = data;
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.reportSec,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.sectionTitle,
								children: [
									"按日（",
									monthly.month,
									"）",
									monthly.fallbackMonth ? ` · 回退自 ${monthly.fallbackMonth}` : ""
								]
							}), (monthly.days ?? []).length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.hint,
								children: "该月暂无记录。"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: Panel_module_css_default.reportTable,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "日期" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "项目" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "进度" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "待办" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "问题" })
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: monthly.days.map((day) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: day.date }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: (day.projects ?? []).join("、") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: (day.progress ?? []).join("；") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: (day.todo ?? []).join("；") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: (day.issues ?? []).join("；") })
								] }, day.date)) })]
							})]
						}), reportProjects(monthly.projects)] });
					} else {
						const daily = data;
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.reportSec,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.sectionTitle,
								children: [
									"每日简报（",
									daily.date,
									"）",
									daily.fallbackFrom ? ` · 回退自 ${daily.fallbackFrom}` : ""
								]
							}), daily.stats ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.hint,
								children: [
									"共 ",
									daily.stats.projects,
									" 个项目 · ",
									daily.stats.progress,
									" 条进度 · ",
									daily.stats.todo,
									" 条待办 · ",
									daily.stats.issues,
									" 条问题"
								]
							}) : null]
						}), reportProjects(daily.projects)] });
					}
				}
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Panel_module_css_default.reportBody,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.reportActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${Panel_module_css_default.reportViewBtn}${reportView === "daily" ? ` ${Panel_module_css_default.reportViewBtnActive}` : ""}`,
								onClick: () => {
									setReportView("daily");
									loadReport("daily");
								},
								children: "日报"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${Panel_module_css_default.reportViewBtn}${reportView === "monthly" ? ` ${Panel_module_css_default.reportViewBtnActive}` : ""}`,
								onClick: () => {
									setReportView("monthly");
									loadReport("monthly");
								},
								children: "月度"
							})]
						}),
						reportError !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Panel_module_css_default.notice,
							children: reportError
						}) : null,
						content
					]
				});
			};
			const headerTitle = tab === "archive" ? "技能档案" : tab === "report" ? "汇报" : view === "create" ? "新建技能" : view === "detail" ? "技能详情" : "技能";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Panel_module_css_default.wrap,
				"data-theme": scheme,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${Panel_module_css_default.toggle}${open ? ` ${Panel_module_css_default.toggleActive}` : ""}`,
					title: "技能目录 / 档案 / 汇报",
					onClick: () => setOpen(!open),
					children: "管理"
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Panel_module_css_default.panel,
					onKeyDown,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.header,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Panel_module_css_default.title,
								children: headerTitle
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Panel_module_css_default.btn,
								"aria-label": "关闭",
								onClick: () => setOpen(false),
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.tabs,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${Panel_module_css_default.tab}${tab === "skills" ? ` ${Panel_module_css_default.tabActive}` : ""}`,
									onClick: () => {
										setTab("skills");
										setView("list");
										setDetail(null);
										setNotice("");
									},
									children: "技能"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${Panel_module_css_default.tab}${tab === "archive" ? ` ${Panel_module_css_default.tabActive}` : ""}`,
									onClick: () => {
										setTab("archive");
										setNotice("");
									},
									children: "档案"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${Panel_module_css_default.tab}${tab === "report" ? ` ${Panel_module_css_default.tabActive}` : ""}`,
									onClick: () => {
										setTab("report");
										setNotice("");
										if (reportData === null && !reportLoading) loadReport();
									},
									children: "汇报"
								})
							]
						}),
						notice !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Panel_module_css_default.notice,
							children: notice
						}) : null,
						usageHealth !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.notice,
							children: ["调用统计写盘失败（技能本身不受影响）：", usageHealth]
						}) : null,
						tab === "archive" ? archiveBody() : tab === "report" ? reportBody() : view === "list" ? listBody() : view === "detail" ? detailBody() : createBody(),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: `${Panel_module_css_default.hint} ${Panel_module_css_default.footer}`,
							children: [
								"来源标注：自创=自己创建 · 外来=下载/他人 · 系统=随 DSH 内置 · 未标注=尚未标记（点击徽标即可切换）。 新加入 .dsh/skills 或 ~/.dsh/skills 的技能会自动出现在「技能」页；档案保存在 ",
								"<工作区>",
								"/.dsh/skill-manager/index.json。"
							]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"sessions",
			"conversation"
		];
		/** Browser plugin body: one self-contained utility entry in the session header. */
		function apply(ctx) {
			const theme = ctx.get("theme");
			let scheme = "light";
			const subscribers = /* @__PURE__ */ new Set();
			if (theme !== void 0) scheme = theme.getTheme().active.colorScheme;
			const onThemeChange = ctx.on;
			onThemeChange("theme/change", (snapshot) => {
				scheme = snapshot.active.colorScheme;
				for (const onChange of subscribers) onChange(scheme);
			});
			const themeScheme = {
				get: () => scheme,
				subscribe: (onChange) => {
					subscribers.add(onChange);
					return () => {
						subscribers.delete(onChange);
					};
				}
			};
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "skill-manager",
				order: 1,
				label: "管理",
				inject: (sessionId) => ({
					sessionId,
					prependDraft: (text) => {
						const actx = ctx.sessions.scope(sessionId);
						if (actx === void 0) return;
						const input = ctx.conversation.input.for(actx);
						const draft = input.state.getSnapshot().draft;
						input.setDraft(draft === "" ? text : `${text}${draft}`);
					},
					themeScheme
				})
			}, Panel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map