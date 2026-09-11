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
		const css = ".JKEyxW_wrap{font-family:var(--dsw-font-family,-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", sans-serif);color:var(--dsw-alias-label-primary,#0f1115);--sm-heat:var(--dsw-alias-state-business-primary,#4176e6);font-size:14px;line-height:22px;position:relative}.JKEyxW_toggle{border:.5px solid var(--dsw-alias-border-l3,#0000001f);corner-shape:round;height:28px;color:var(--dsw-alias-label-primary,#0f1115);font:inherit;cursor:pointer;background:0 0;border-radius:14px;padding:0 10px;font-size:12px;line-height:18px;transition:background-color .12s,border-color .12s,color .12s}.JKEyxW_toggle:hover{background:var(--dsw-alias-interactive-bg-hover-solid,#f1f3f5)}.JKEyxW_toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}.JKEyxW_toggleActive{background:var(--dsw-alias-button-primary-fill,#0f1115);border-color:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}.JKEyxW_panel{z-index:100;box-sizing:border-box;background:var(--dsw-specific-menu,#fff);width:min(620px,90vw);max-height:min(560px,75vh);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,#0000000a);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#e5e5e5);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#d4d4d4);border:0;border-radius:20px;flex-direction:column;padding:4px;display:flex;position:absolute;top:calc(100% + 8px);right:0;overflow-y:auto}.JKEyxW_header{flex-direction:row;align-items:center;gap:8px;min-height:40px;padding:6px 10px;display:flex}.JKEyxW_tabs{border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a);gap:22px;padding:0 10px;display:flex}.JKEyxW_tab{color:var(--dsw-alias-label-tertiary,#81858c);font:inherit;cursor:pointer;background:0 0;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}.JKEyxW_tab:hover{color:var(--dsw-alias-label-primary,#0f1115)}.JKEyxW_tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px;border-radius:2px}.JKEyxW_tabActive{color:var(--dsw-alias-label-primary,#0f1115)}.JKEyxW_tabActive:after{content:\"\";background:var(--dsw-alias-label-primary,#0f1115);border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}.JKEyxW_search{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4,#00000029);background:var(--dsw-alias-bg-layer-1,#fff);min-width:0;height:32px;color:var(--dsw-alias-label-primary,#0f1115);font:inherit;border-radius:8px;flex:1;padding:0 10px;font-size:14px;line-height:22px}.JKEyxW_search::placeholder{color:var(--dsw-alias-label-dimmed,#e1e5ee)}.JKEyxW_search:focus{border-color:var(--dsw-alias-brand-primary,#0f1115);outline:none}.JKEyxW_list{flex-direction:column;gap:2px;padding:4px;display:flex}.JKEyxW_row{cursor:pointer;border-radius:10px;flex-direction:row;align-items:center;gap:8px;min-height:40px;padding:6px 10px;transition:background-color .12s;display:flex}.JKEyxW_row:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}.JKEyxW_rowMain{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.JKEyxW_rowName{color:var(--dsw-alias-label-primary,#0f1115);flex-wrap:wrap;align-items:center;gap:6px;font-size:13px;font-weight:500;line-height:20px;display:flex}.JKEyxW_rowDesc{color:var(--dsw-alias-label-secondary,#61666b);font-size:12px;line-height:18px}.JKEyxW_btn{border:.5px solid var(--dsw-alias-border-l3,#0000001f);corner-shape:round;height:28px;color:var(--dsw-alias-label-primary,#0f1115);font:inherit;cursor:pointer;background:0 0;border-radius:14px;justify-content:center;align-items:center;gap:4px;padding:0 10px;font-size:12px;line-height:18px;transition:background-color .12s,border-color .12s,color .12s;display:inline-flex}.JKEyxW_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,#f1f3f5)}.JKEyxW_btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}.JKEyxW_btn:disabled{opacity:.4;cursor:default}.JKEyxW_btnPrimary{background:var(--dsw-alias-button-primary-fill,#0f1115);border-color:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}.JKEyxW_btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#43454a);border-color:var(--dsw-alias-button-primary-hover,#43454a)}.JKEyxW_btnDanger{color:var(--dsw-alias-state-error-primary,#ec1313);background:0 0;border-color:#0000}.JKEyxW_btnDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,#ec13130d)}.JKEyxW_badge{border:.5px solid var(--dsw-alias-border-l3,#0000001f);color:var(--dsw-alias-label-secondary,#61666b);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;font-weight:400;line-height:16px}.JKEyxW_badgeOk{background:var(--dsw-specific-sidebar-nav-item-active-accent,#e4edfd);color:var(--dsw-alias-button-info-fill,#4176e6);border-color:#0000}.JKEyxW_hint{color:var(--dsw-alias-label-tertiary,#81858c);padding:4px 10px;font-size:12px;line-height:18px}.JKEyxW_muted{color:var(--dsw-alias-label-caption,#adb2b8)}.JKEyxW_notice{background:var(--dsw-alias-state-warn-tertiary,#fef5e7);color:var(--dsw-alias-state-error-primary,#ec1313);border-radius:10px;margin:4px 10px;padding:8px 10px;font-size:12px;line-height:18px}.JKEyxW_chips{flex-wrap:wrap;gap:8px;padding:8px 10px 4px;display:flex}.JKEyxW_chip{border:.5px solid var(--dsw-alias-border-l4,#00000029);corner-shape:round;height:28px;color:var(--dsw-alias-label-primary,#0f1115);font:inherit;cursor:pointer;background:0 0;border-radius:14px;padding:0 12px;font-size:13px;line-height:18px;transition:background-color .12s,border-color .12s,color .12s}.JKEyxW_chip:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}.JKEyxW_chip:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#0f1115);outline-offset:2px}.JKEyxW_chipActive{background:var(--dsw-alias-button-primary-fill,#0f1115);border-color:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}.JKEyxW_section{flex-direction:column;gap:8px;padding:8px 10px;display:flex}.JKEyxW_sectionTitle{color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;font-weight:500;line-height:18px}.JKEyxW_card{border:.5px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:16px;flex-direction:column;gap:4px;padding:12px 14px;display:flex}.JKEyxW_cardHead{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.JKEyxW_detailMeta{flex-direction:column;gap:4px;padding:8px 10px;display:flex}.JKEyxW_detailDesc{color:var(--dsw-alias-label-secondary,#61666b);font-size:13px;line-height:20px}.JKEyxW_detailWhen{color:var(--dsw-alias-label-secondary,#61666b);font-size:12px;line-height:18px}.JKEyxW_detailSrc{font-family:var(--ds-font-family-code,\"SF Mono\", Menlo, monospace);color:var(--dsw-alias-label-caption,#adb2b8);word-break:break-all;font-size:11px;line-height:16px}.JKEyxW_detailActions{flex-wrap:wrap;gap:8px;padding:4px 10px 8px;display:flex}.JKEyxW_pre{background:var(--dsw-alias-markdown-code-block,#f9fafb);max-height:320px;color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--ds-font-family-code,\"SF Mono\", Menlo, monospace);white-space:pre-wrap;word-break:break-word;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#e5e5e5);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#d4d4d4);border-radius:8px;margin:0 10px 10px;padding:10px 12px;font-size:12px;line-height:19px;overflow:auto}.JKEyxW_profile{flex-direction:column;gap:2px;padding:4px 0;display:flex}.JKEyxW_profileRow{color:var(--dsw-alias-label-secondary,#61666b);font-size:12px;line-height:20px}.JKEyxW_originChips{gap:4px;display:inline-flex}.JKEyxW_originChip{border:.5px solid var(--dsw-alias-border-l4,#00000029);corner-shape:round;height:22px;color:var(--dsw-alias-label-tertiary,#81858c);font:inherit;cursor:pointer;background:0 0;border-radius:11px;padding:0 8px;font-size:11px;line-height:14px;transition:background-color .12s,color .12s}.JKEyxW_originChip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}.JKEyxW_originChip:disabled{opacity:.4;cursor:default}.JKEyxW_originChipActive{background:var(--dsw-alias-button-primary-fill,#0f1115);border-color:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}.JKEyxW_originSmall .JKEyxW_originChip{height:20px;padding:0 6px;font-size:10px;line-height:14px}.JKEyxW_reportBody{flex-direction:column;display:flex}.JKEyxW_reportActions{flex-wrap:wrap;gap:8px;padding:8px 10px 4px;display:flex}.JKEyxW_reportViewBtn{border:.5px solid var(--dsw-alias-border-l4,#00000029);corner-shape:round;height:28px;color:var(--dsw-alias-label-primary,#0f1115);font:inherit;cursor:pointer;background:0 0;border-radius:14px;padding:0 12px;font-size:13px;line-height:18px;transition:background-color .12s,border-color .12s,color .12s}.JKEyxW_reportViewBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f)}.JKEyxW_reportViewBtn:disabled{opacity:.4;cursor:default}.JKEyxW_reportViewBtnActive{background:var(--dsw-alias-button-primary-fill,#0f1115);border-color:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}.JKEyxW_reportSec{flex-direction:column;gap:6px;padding:8px 10px;display:flex}.JKEyxW_reportProject{border-bottom:.5px solid var(--dsw-alias-border-l1,#0000000a);color:var(--dsw-alias-label-secondary,#61666b);flex-direction:column;gap:2px;padding:8px 0;font-size:12px;line-height:20px;display:flex}.JKEyxW_reportProject strong{color:var(--dsw-alias-label-primary,#0f1115);font-size:13px;font-weight:500}.JKEyxW_heatStrip{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#e5e5e5);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#d4d4d4);flex-wrap:nowrap;align-items:flex-start;gap:3px;padding:2px 10px 6px;display:flex;overflow-x:auto}.JKEyxW_heatDay{flex-direction:column;align-items:center;gap:2px;display:flex}.JKEyxW_heatCell{background:var(--dsw-alias-interactive-bg-hover-solid,#f1f3f5);border-radius:2px;width:14px;height:14px;display:inline-block}.JKEyxW_heatL1{background:color-mix(in srgb, var(--sm-heat) 25%, var(--dsw-alias-bg-base,#fff))}.JKEyxW_heatL2{background:color-mix(in srgb, var(--sm-heat) 50%, var(--dsw-alias-bg-base,#fff))}.JKEyxW_heatL3{background:color-mix(in srgb, var(--sm-heat) 75%, var(--dsw-alias-bg-base,#fff))}.JKEyxW_heatL4{background:var(--sm-heat)}.JKEyxW_heatDayLabel{min-height:9px;color:var(--dsw-alias-label-caption,#adb2b8);font-size:9px;line-height:1}@media (prefers-reduced-motion:reduce){.JKEyxW_toggle,.JKEyxW_btn,.JKEyxW_chip,.JKEyxW_row,.JKEyxW_originChip,.JKEyxW_reportViewBtn{transition:none}}";
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
			"header": "JKEyxW_header",
			"heatCell": "JKEyxW_heatCell",
			"heatDay": "JKEyxW_heatDay",
			"heatDayLabel": "JKEyxW_heatDayLabel",
			"heatL1": "JKEyxW_heatL1",
			"heatL2": "JKEyxW_heatL2",
			"heatL3": "JKEyxW_heatL3",
			"heatL4": "JKEyxW_heatL4",
			"heatStrip": "JKEyxW_heatStrip",
			"hint": "JKEyxW_hint",
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
			"reportProject": "JKEyxW_reportProject",
			"reportSec": "JKEyxW_reportSec",
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
		/** 列表页分类值：「未建档」。 */
		const UNPROFILED_FILTER = "unprofiled";
		/** 是否已建档：方向是非空字符串——与 host 写档案时的校验口径一致。 */
		function isProfiledSkill(direction) {
			return typeof direction === "string" && direction !== "";
		}
		/** 判断一个技能是否命中分类值；未知分类值一律不命中。 */
		function skillMatchesFilter(filter, direction) {
			if (filter === "all") return true;
			if (filter === "unprofiled") return !isProfiledSkill(direction);
			return direction === filter;
		}
		/**
		* 技能目录页的分类 chip：全部、未建档，以及**当前目录里确实有技能**的方向
		* （按 canonical 顺序）。空方向不出现——这里给的是当前目录的分类，不是分类总表。
		*/
		function skillFilterChips(skills) {
			const counts = /* @__PURE__ */ new Map();
			let unprofiled = 0;
			for (const skill of skills) {
				if (!isProfiledSkill(skill.direction)) {
					unprofiled += 1;
					continue;
				}
				const direction = skill.direction;
				counts.set(direction, (counts.get(direction) ?? 0) + 1);
			}
			const directionChips = DIRECTION_LABELS.filter((label) => (counts.get(label) ?? 0) > 0).map((label) => ({
				value: label,
				label,
				count: counts.get(label) ?? 0
			}));
			return [
				{
					value: "all",
					label: "全部",
					count: skills.length
				},
				{
					value: UNPROFILED_FILTER,
					label: "未建档",
					count: unprofiled
				},
				...directionChips
			];
		}
		//#endregion
		//#region src/client/Panel.tsx
		/**
		* Skills 管理面板：目录浏览/搜索/方向分类筛选/详情/调用/建档，档案页
		* （方向筛选、未建档清单、档案卡片、停用/重装/删除）。
		* 分类口径与档案页同轴（directions.ts 的 canonical 10 类 + 未建档），
		* 逻辑在 skill-filter.ts 里，便于脱离 DOM 断言。
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
		function Panel({ sessionId, prependDraft }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [data, setData] = (0, react.useState)(null);
			const [query, setQuery] = (0, react.useState)("");
			const [tab, setTab] = (0, react.useState)("skills");
			const [view, setView] = (0, react.useState)("list");
			const [detail, setDetail] = (0, react.useState)(null);
			const [filter, setFilter] = (0, react.useState)("all");
			/** 「技能」页的方向分类筛选；与档案页的 filter 分开，两页的取值集合不同。 */
			const [skillFilter, setSkillFilter] = (0, react.useState)("all");
			const [confirmName, setConfirmName] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
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
			const originKeyOfName = (name, source) => {
				const entry = profiles[name];
				if (entry !== void 0 && entry.origin !== void 0) return entry.origin;
				if (source === "bundled") return "system";
			};
			const originOf = (s) => {
				const key = originKeyOfName(s.name, s.source) ?? "unknown";
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
			/** 分类 chip：技能页的分类与档案页的筛选共用同一套渲染，取值与命中口径各自传入。 */
			const chip = (label, value, active, onPick, count, title) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `${Panel_module_css_default.chip}${active ? ` ${Panel_module_css_default.chipActive}` : ""}`,
				title,
				onClick: () => onPick(value),
				children: [label, count !== void 0 ? ` ${count}` : ""]
			}, value);
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
						fsSkill ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
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
				const all = skills ?? [];
				const chips = skillFilterChips(all.map((s) => ({
					name: s.name,
					direction: profiles[s.name]?.direction
				})));
				const filtered = skills === null ? null : all.filter((s) => {
					if (!skillMatchesFilter(skillFilter, profiles[s.name]?.direction)) return false;
					if (q === "") return true;
					return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [skills === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.chips,
					children: chips.map((c) => chip(c.label, c.value, skillFilter === c.value, setSkillFilter, c.count, DIRECTION_HINTS[c.value]))
				}), skills === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.hint,
					children: "加载中…"
				}) : filtered !== null && filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.hint,
					children: skills.length === 0 ? "当前没有可用技能" : "没有匹配的技能"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.list,
					children: (filtered ?? []).map(row)
				})] });
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
								value: originKeyOfName(d.name, d.source)
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
							FS_SOURCES.includes(d.source) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
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
			const archiveBody = () => {
				const profiledNames = Object.keys(profiles);
				const unprofiled = skills === null ? [] : skills.filter((s) => !hasProfile(s.name) && matches([s.name, s.description]));
				const trashedNames = Object.keys(trash);
				const usageByName = new Map(summarizeUsage(usage, Date.now()).map((entry) => [entry.name, entry]));
				const needsReview = reviewCandidates(profiles, usage, Date.now(), 5);
				const directionSet = new Set(DIRECTION_LABELS);
				for (const n of profiledNames) {
					const d = profiles[n]?.direction;
					if (typeof d === "string" && d !== "") directionSet.add(d);
				}
				const directionOptions = Array.from(directionSet);
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
							chip("全部", "all", filter === "all", setFilter),
							chip("未建档", UNPROFILED_FILTER, filter === UNPROFILED_FILTER, setFilter, unprofiled.length),
							chip("启用中", "active", filter === "active", setFilter),
							chip("已停用", "trashed", filter === "trashed", setFilter, trashedNames.length),
							directionOptions.map((d) => chip(d, d, filter === d, setFilter, void 0, DIRECTION_HINTS[d])),
							ORIGIN_KEYS.map((k) => chip(ORIGIN_LABELS[k], k, filter === k, setFilter))
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
								children: "按「易变方向 + 长期未用 + 久未复审」排序，点进去看档案再决定更新还是删。"
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
				reportRpc(view === "daily" ? "generateDaily" : view === "weekly" ? "generateWeekly" : "generateMonthly", { sessionId }).then((data) => {
					setReportError(reportFailureMessage(data));
					setReportData(data);
					setReportLoading(false);
				}).catch((error) => {
					setReportError(String(error));
					setReportLoading(false);
				});
			};
			const joinItems = (items) => {
				const list = items ?? [];
				if (list.length === 0) return "无";
				return list.length <= 3 ? list.join("；") : `${list.slice(0, 3).join("；")}（+${list.length - 3}）`;
			};
			const WEEKDAY_LABELS = [
				"一",
				"二",
				"三",
				"四",
				"五",
				"六",
				"日"
			];
			const HEAT_STEPS = [
				9,
				29,
				59
			];
			/** 越深＝那天做得越多（GitHub 贡献图的绿阶）。 */
			const heatClass = (count) => {
				if (count <= 0) return "";
				if (count <= HEAT_STEPS[0]) return ` ${Panel_module_css_default.heatL1}`;
				if (count <= HEAT_STEPS[1]) return ` ${Panel_module_css_default.heatL2}`;
				if (count <= HEAT_STEPS[2]) return ` ${Panel_module_css_default.heatL3}`;
				return ` ${Panel_module_css_default.heatL4}`;
			};
			const heatTitle = (date, day) => {
				if (day === void 0 || day.count === 0) return `${date} · 无记录`;
				const who = day.projects.length > 0 ? `：${day.projects.join("、")}` : "";
				return `${date} · ${day.count} 条进展${who}`;
			};
			const reportHeat = (range, showWeekday) => {
				const byDate = new Map(range.days.map((day) => [day.date, day]));
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.heatStrip,
					children: range.dates.map((date) => {
						const weekday = ((/* @__PURE__ */ new Date(`${date}T00:00:00`)).getDay() + 6) % 7;
						const dayNum = Number(date.slice(8));
						const showNum = showWeekday || dayNum === 1 || dayNum % 5 === 0;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.heatDay,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `${Panel_module_css_default.heatCell}${heatClass(byDate.get(date)?.count ?? 0)}`,
									title: heatTitle(date, byDate.get(date))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Panel_module_css_default.heatDayLabel,
									children: showWeekday ? WEEKDAY_LABELS[weekday] : showNum ? dayNum : ""
								}),
								showWeekday ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Panel_module_css_default.heatDayLabel,
									children: dayNum
								}) : null
							]
						}, date);
					})
				});
			};
			/** 周报/月报的项目卡：作用 / 进度 / 待办 / 难点，一行一项，不展开。 */
			const reportRangeProjects = (allProjects) => {
				const projects = allProjects.filter((project) => matches([
					project.name,
					project.purpose,
					project.progress,
					...project.todo,
					...project.issues
				]));
				if (projects.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.hint,
					children: "该区间暂无记录。按 brief skill 维护 reporter/brief/YYYY-MM-DD.md，这里会自动汇总。"
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: Panel_module_css_default.reportSec,
					children: projects.map((project) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.reportProject,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: project.name }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["作用：", project.purpose || "—"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["进度：", project.progress || "—"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["待办：", joinItems(project.todo)] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["难点：", joinItems(project.issues)] })
						]
					}, project.name))
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
				const list = (projects ?? []).filter((project) => matches([
					project.name,
					project.purpose,
					project.impl,
					...project.progress,
					...project.todo,
					...project.issues
				]));
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
					if (reportView !== "daily" && "dates" in data) {
						const range = data;
						const title = reportView === "weekly" ? "周报" : "月报";
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.reportSec,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.sectionTitle,
								children: [
									title,
									" ",
									range.label,
									range.fallbackFrom ? ` · 回退自 ${range.fallbackFrom}` : ""
								]
							}), range.days.length > 0 ? reportHeat(range, reportView === "weekly") : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Panel_module_css_default.hint,
								children: "该区间暂无记录。"
							})]
						}), reportRangeProjects(range.projects)] });
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
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${Panel_module_css_default.reportViewBtn}${reportView === "daily" ? ` ${Panel_module_css_default.reportViewBtnActive}` : ""}`,
									onClick: () => {
										setReportView("daily");
										loadReport("daily");
									},
									children: "日报"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${Panel_module_css_default.reportViewBtn}${reportView === "weekly" ? ` ${Panel_module_css_default.reportViewBtnActive}` : ""}`,
									onClick: () => {
										setReportView("weekly");
										loadReport("weekly");
									},
									children: "周报"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${Panel_module_css_default.reportViewBtn}${reportView === "monthly" ? ` ${Panel_module_css_default.reportViewBtnActive}` : ""}`,
									onClick: () => {
										setReportView("monthly");
										loadReport("monthly");
									},
									children: "月报"
								})
							]
						}),
						reportError !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Panel_module_css_default.notice,
							children: reportError
						}) : null,
						content
					]
				});
			};
			const q = query.trim().toLowerCase();
			const matches = (parts) => {
				if (q === "") return true;
				return parts.some((part) => typeof part === "string" && part.toLowerCase().includes(q));
			};
			const searchPlaceholder = tab === "archive" ? "搜索技能名 / 使用范围 / 边界 / 场景…" : tab === "report" ? "搜索项目 / 作用 / 进度 / 待办 / 难点…" : "搜索技能名或描述…";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Panel_module_css_default.wrap,
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
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: Panel_module_css_default.search,
									type: "text",
									placeholder: searchPlaceholder,
									value: query,
									autoFocus: true,
									onChange: (e) => setQuery(e.target.value)
								}),
								query !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: "清除",
									title: "清空搜索",
									onClick: () => setQuery("")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Panel_module_css_default.btn,
									"aria-label": "关闭",
									onClick: () => setOpen(false),
									children: "×"
								})
							]
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
						tab === "archive" ? archiveBody() : tab === "report" ? reportBody() : view === "list" ? listBody() : detailBody()
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
					}
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