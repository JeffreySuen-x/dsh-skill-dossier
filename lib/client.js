window.__ModuleLoader__.load({
	id: "dsh-skill-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:src/client/Panel.module.css.mjs
		const css = ".yTY71a_wrap[data-theme=light]{--sm-bg:#fff;--sm-bg-2:#f5f5f5;--sm-hover:#ececec;--sm-text:#000;--sm-text-2:#5c5c5c;--sm-border:#d9d9d9;--sm-border-2:#8a8a8a;--sm-fill:#000;--sm-fill-text:#fff;--sm-shadow:0 0 1px 0 #0003, 0 12px 32px 0 #0000002e}.yTY71a_wrap[data-theme=dark]{--sm-bg:#000;--sm-bg-2:#171717;--sm-hover:#1f1f1f;--sm-text:#fff;--sm-text-2:#a3a3a3;--sm-border:#343434;--sm-border-2:#6b6b6b;--sm-fill:#fff;--sm-fill-text:#000;--sm-shadow:0 0 1px 0 #ffffff40, 0 12px 32px 0 #000c}.yTY71a_wrap{align-items:center;display:inline-flex;position:relative}.yTY71a_toggle{border:1px solid var(--sm-border);height:26px;color:var(--sm-text-2);cursor:pointer;background:0 0;border-radius:8px;justify-content:center;align-items:center;padding:0 10px;font-size:12px;line-height:1;display:inline-flex;transform:translateZ(0)}.yTY71a_toggle:hover{background:var(--sm-hover)}.yTY71a_toggleActive{color:var(--sm-fill);border-color:var(--sm-fill)}.yTY71a_panel{z-index:1000;border:1px solid var(--sm-border);background:var(--sm-bg);width:min(620px,90vw);max-height:min(560px,75vh);box-shadow:var(--sm-shadow);color:var(--sm-text);text-align:left;border-radius:12px;flex-direction:column;padding:4px;font-size:13px;display:flex;position:absolute;top:calc(100% + 8px);right:0;overflow:hidden}.yTY71a_header{align-items:center;gap:6px;padding:6px 8px;display:flex}.yTY71a_title{flex:auto;font-size:13px;font-weight:600}.yTY71a_tabs{border-bottom:1px solid var(--sm-border);gap:2px;padding:0 8px 4px;display:flex}.yTY71a_tab{color:var(--sm-text-2);cursor:pointer;background:0 0;border:none;border-radius:6px 6px 0 0;padding:4px 10px;font-size:12px}.yTY71a_tab:hover{color:var(--sm-text)}.yTY71a_tabActive{color:var(--sm-fill);box-shadow:inset 0 -2px 0 var(--sm-fill)}.yTY71a_search{box-sizing:border-box;border:1px solid var(--sm-border);background:var(--sm-bg-2);width:100%;color:var(--sm-text);border-radius:8px;outline:none;margin:2px 0 4px;padding:7px 10px;font-size:13px}.yTY71a_list{flex-direction:column;flex:auto;gap:2px;min-height:0;padding:2px 0;display:flex;overflow-y:auto}.yTY71a_row{cursor:pointer;border-radius:8px;align-items:flex-start;gap:8px;padding:8px 10px;display:flex}.yTY71a_row:hover{background:var(--sm-hover)}.yTY71a_rowMain{flex:auto;min-width:0}.yTY71a_rowName{font-size:13px;font-weight:600}.yTY71a_rowDesc{color:var(--sm-text-2);text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font-size:12px;overflow:hidden}.yTY71a_badge{border:1px solid var(--sm-border-2);color:var(--sm-text-2);vertical-align:middle;border-radius:999px;margin-left:6px;padding:0 6px;font-size:10px;font-weight:400;line-height:16px;display:inline-block}.yTY71a_badgeOk{background:var(--sm-fill);border-color:var(--sm-fill);color:var(--sm-fill-text)}.yTY71a_btn{border:1px solid var(--sm-border-2);color:var(--sm-text);cursor:pointer;background:0 0;border-radius:6px;flex:none;padding:3px 10px;font-size:12px;line-height:18px}.yTY71a_btn:hover{background:var(--sm-hover)}.yTY71a_btn:disabled{opacity:.45;cursor:default}.yTY71a_btnPrimary{background:var(--sm-fill);border-color:var(--sm-fill);color:var(--sm-fill-text)}.yTY71a_btnDanger{font-weight:600}.yTY71a_notice{color:var(--sm-text);padding:4px 10px;font-size:12px;font-weight:600}.yTY71a_notice:before{content:\"⚠ \"}.yTY71a_hint{color:var(--sm-text-2);padding:6px 10px;font-size:11px;line-height:1.5}.yTY71a_footer{border-top:1px solid var(--sm-border);margin-top:4px}.yTY71a_detailMeta{flex-direction:column;gap:4px;padding:2px 10px 8px;display:flex}.yTY71a_detailDesc{font-size:12px}.yTY71a_detailWhen{color:var(--sm-text-2);font-size:12px}.yTY71a_detailSrc{color:var(--sm-text-2);word-break:break-all;font-size:11px}.yTY71a_detailActions{flex-wrap:wrap;gap:6px;padding:2px 10px 8px;display:flex}.yTY71a_pre{border:1px solid var(--sm-border);background:var(--sm-bg-2);white-space:pre-wrap;border-radius:8px;flex:auto;min-height:0;margin:0 10px 10px;padding:10px;font-size:12px;line-height:1.6;overflow:auto}.yTY71a_form{flex-direction:column;gap:8px;min-height:0;padding:2px 10px 10px;display:flex;overflow-y:auto}.yTY71a_input{box-sizing:border-box;border:1px solid var(--sm-border);background:var(--sm-bg-2);width:100%;color:var(--sm-text);border-radius:8px;outline:none;padding:7px 10px;font-size:13px}.yTY71a_textarea{box-sizing:border-box;border:1px solid var(--sm-border);background:var(--sm-bg-2);width:100%;color:var(--sm-text);resize:vertical;border-radius:8px;outline:none;padding:8px 10px;font-family:inherit;font-size:12px;line-height:1.6}.yTY71a_formRow{cursor:pointer;align-items:center;gap:6px;font-size:12px;display:flex}.yTY71a_chips{flex-wrap:wrap;gap:4px;padding:6px 10px;display:flex}.yTY71a_chip{border:1px solid var(--sm-border-2);color:var(--sm-text-2);cursor:pointer;background:0 0;border-radius:999px;padding:2px 8px;font-size:11px;line-height:16px}.yTY71a_chip:hover{color:var(--sm-text)}.yTY71a_chipActive{color:var(--sm-fill);border-color:var(--sm-fill);background:var(--sm-bg-2)}.yTY71a_section{flex-direction:column;gap:6px;min-height:0;padding:4px 10px 8px;display:flex;overflow-y:auto}.yTY71a_sectionTitle{color:var(--sm-text-2);letter-spacing:.4px;font-size:11px;font-weight:600}.yTY71a_card{border:1px solid var(--sm-border);border-radius:8px;flex-direction:column;gap:4px;padding:8px 10px;display:flex}.yTY71a_cardHead{flex-wrap:wrap;align-items:center;gap:4px;display:flex}.yTY71a_profile{border:1px solid var(--sm-border);background:var(--sm-bg-2);border-radius:8px;flex-direction:column;gap:4px;padding:8px 10px;display:flex}.yTY71a_profileRow{font-size:12px;line-height:1.6}.yTY71a_originChips{flex-wrap:wrap;align-items:center;gap:3px;display:inline-flex}.yTY71a_originSmall .yTY71a_originChip{padding:0 6px;font-size:10px;line-height:15px}.yTY71a_originChip{border:1px solid var(--sm-border-2);color:var(--sm-text-2);cursor:pointer;background:0 0;border-radius:999px;padding:1px 7px;font-size:11px;line-height:16px}.yTY71a_originChip:hover{color:var(--sm-text)}.yTY71a_originChipActive{color:var(--sm-fill);border-color:var(--sm-fill);background:var(--sm-bg-2)}.yTY71a_originChip:disabled{opacity:.45;cursor:default}";
		const tagId = "dsh-skill-manager/Panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skill-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Panel_module_css_default = {
			"cardHead": "yTY71a_cardHead",
			"detailWhen": "yTY71a_detailWhen",
			"tabActive": "yTY71a_tabActive",
			"input": "yTY71a_input",
			"rowName": "yTY71a_rowName",
			"hint": "yTY71a_hint",
			"sectionTitle": "yTY71a_sectionTitle",
			"tabs": "yTY71a_tabs",
			"footer": "yTY71a_footer",
			"btnDanger": "yTY71a_btnDanger",
			"detailActions": "yTY71a_detailActions",
			"chip": "yTY71a_chip",
			"rowMain": "yTY71a_rowMain",
			"header": "yTY71a_header",
			"toggle": "yTY71a_toggle",
			"toggleActive": "yTY71a_toggleActive",
			"detailMeta": "yTY71a_detailMeta",
			"section": "yTY71a_section",
			"card": "yTY71a_card",
			"profile": "yTY71a_profile",
			"originSmall": "yTY71a_originSmall",
			"badge": "yTY71a_badge",
			"chips": "yTY71a_chips",
			"list": "yTY71a_list",
			"originChip": "yTY71a_originChip",
			"originChipActive": "yTY71a_originChipActive",
			"pre": "yTY71a_pre",
			"detailDesc": "yTY71a_detailDesc",
			"btnPrimary": "yTY71a_btnPrimary",
			"row": "yTY71a_row",
			"btn": "yTY71a_btn",
			"notice": "yTY71a_notice",
			"originChips": "yTY71a_originChips",
			"detailSrc": "yTY71a_detailSrc",
			"title": "yTY71a_title",
			"rowDesc": "yTY71a_rowDesc",
			"panel": "yTY71a_panel",
			"badgeOk": "yTY71a_badgeOk",
			"form": "yTY71a_form",
			"textarea": "yTY71a_textarea",
			"search": "yTY71a_search",
			"wrap": "yTY71a_wrap",
			"tab": "yTY71a_tab",
			"chipActive": "yTY71a_chipActive",
			"formRow": "yTY71a_formRow",
			"profileRow": "yTY71a_profileRow"
		};
		//#endregion
		//#region src/client/Panel.tsx
		/**
		* Skills 管理面板：目录浏览/搜索/详情/调用/建档，档案页（方向筛选、
		* 未建档清单、档案卡片、停用/重装/删除），以及会话级临时技能的注册与卸载。
		* 组件自包含（按钮 + 弹层），无宿主 hook 依赖。
		*/
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
		async function rpc(method, args) {
			const res = await fetch("/api/skill-manager", {
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
		function normalizeList(res) {
			const r = res ?? {};
			const idx = r.index ?? {};
			return {
				skills: Array.isArray(r.skills) ? r.skills : [],
				index: {
					skills: idx.skills !== null && typeof idx.skills === "object" ? idx.skills : {},
					trash: idx.trash !== null && typeof idx.trash === "object" ? idx.trash : {}
				}
			};
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
			const [matchQuery, setMatchQuery] = (0, react.useState)("");
			const [matches, setMatches] = (0, react.useState)(null);
			const [matchTotal, setMatchTotal] = (0, react.useState)(0);
			const [matchBusy, setMatchBusy] = (0, react.useState)(false);
			const [matchError, setMatchError] = (0, react.useState)("");
			const reload = () => {
				setData(null);
				rpc("list", { sessionId }).then((res) => setData(normalizeList(res))).catch((error) => {
					setData({
						skills: [],
						index: {
							skills: {},
							trash: {}
						}
					});
					setNotice(String(error));
				});
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				let cancelled = false;
				setData(null);
				rpc("list", { sessionId }).then((res) => {
					if (!cancelled) setData(normalizeList(res));
				}).catch((error) => {
					if (!cancelled) {
						setData({
							skills: [],
							index: {
								skills: {},
								trash: {}
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
			const skills = data?.skills ?? null;
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
				rpc(method, arg).then((res) => {
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
			const runMatch = () => {
				const q = matchQuery.trim();
				if (q === "") {
					setMatchError("请输入任务描述，例如「帮我写一个登录页面」");
					return;
				}
				setMatchBusy(true);
				setMatchError("");
				rpc("match", {
					query: q,
					sessionId
				}).then((res) => {
					setMatchBusy(false);
					if (res !== null && typeof res === "object" && res.ok === true) {
						setMatches(res.matches ?? []);
						setMatchTotal(res.total ?? 0);
					} else {
						setMatches([]);
						setMatchError(res !== null && typeof res === "object" && typeof res.error === "string" ? res.error : "匹配失败");
					}
				}).catch((error) => {
					setMatchBusy(false);
					setMatches([]);
					setMatchError(String(error));
				});
			};
			const ingest = (name) => doCall("ingest", {
				name,
				sessionId
			}, () => setOpen(false));
			const uninstall = (name) => doCall("uninstall", {
				name,
				sessionId
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
				rpc("get", {
					name,
					sessionId
				}).then((res) => setDetail(res)).catch((error) => {
					setDetail(null);
					setNotice(String(error));
				});
			};
			const submitCreate = () => {
				const name = form.name.trim();
				if (!NAME_RE.test(name)) {
					setNotice("名称必须是 kebab-case（小写字母、数字、连字符）");
					return;
				}
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
				rpc("register", {
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
						}) : fsSkill ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							label: "停用",
							onClick: (e) => {
								e.stopPropagation();
								uninstall(s.name);
							}
						}) : null
					]
				}, s.name);
			};
			const listBody = () => {
				const q = query.trim().toLowerCase();
				const filtered = skills === null ? null : skills.filter((s) => {
					if (q === "") return true;
					return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					className: Panel_module_css_default.search,
					type: "text",
					placeholder: "搜索名称或描述…",
					value: query,
					autoFocus: true,
					onChange: (e) => setQuery(e.target.value)
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
				const directionSet = new Set(DIRECTIONS);
				for (const n of profiledNames) {
					const d = profiles[n]?.direction;
					if (typeof d === "string" && d !== "") directionSet.add(d);
				}
				const directionOptions = Array.from(directionSet);
				const chip = (label, value, count) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: `${Panel_module_css_default.chip}${filter === value ? ` ${Panel_module_css_default.chipActive}` : ""}`,
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
								})] }) : active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: "停用",
									onClick: () => uninstall(name)
								}) : null]
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
							directionOptions.map((d) => chip(d, d)),
							ORIGIN_KEYS.map((k) => chip(ORIGIN_LABELS[k], k))
						]
					}),
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
			const matchBody = () => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Panel_module_css_default.form,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: Panel_module_css_default.search,
						type: "text",
						placeholder: "描述当前任务，从已建档技能里找最合适的…",
						value: matchQuery,
						autoFocus: true,
						onChange: (e) => setMatchQuery(e.target.value),
						onKeyDown: (e) => {
							if (e.key === "Enter") runMatch();
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Panel_module_css_default.detailActions,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							label: matchBusy ? "匹配中…" : "匹配",
							kind: "primary",
							onClick: runMatch
						})
					}),
					matchError !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Panel_module_css_default.notice,
						children: matchError
					}) : null,
					matches === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Panel_module_css_default.hint,
						children: "输入任务描述后点「匹配」，例如「帮我写一个登录页面」「调研某行业前景」。"
					}) : matches.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Panel_module_css_default.hint,
						children: "没有匹配的已建档技能。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Panel_module_css_default.sectionTitle,
						children: [
							"匹配结果（",
							matches.length,
							" / ",
							matchTotal,
							" 已建档）"
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Panel_module_css_default.list,
						children: matches.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Panel_module_css_default.rowMain,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Panel_module_css_default.rowName,
										children: [
											m.name,
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: `${Panel_module_css_default.badge} ${Panel_module_css_default.badgeOk}`,
												children: m.direction
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: Panel_module_css_default.badge,
												children: ["相关度 ", m.score]
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: Panel_module_css_default.rowDesc,
										children: m.useScope
									}),
									m.matched.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: Panel_module_css_default.rowDesc,
										children: ["命中：", m.matched.join(" · ")]
									}) : null
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								label: "调用",
								kind: "primary",
								onClick: () => invoke(m.name)
							})]
						}, m.name))
					})] })
				]
			});
			const headerTitle = tab === "archive" ? "技能档案" : tab === "match" ? "技能匹配" : view === "create" ? "新建技能" : view === "detail" ? "技能详情" : "Skills";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Panel_module_css_default.wrap,
				"data-theme": scheme,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${Panel_module_css_default.toggle}${open ? ` ${Panel_module_css_default.toggleActive}` : ""}`,
					title: "Skills：识别建档、管理与调用技能",
					onClick: () => setOpen(!open),
					children: "Skills"
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: Panel_module_css_default.panel,
					onKeyDown,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: Panel_module_css_default.header,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Panel_module_css_default.title,
									children: headerTitle
								}),
								tab === "skills" && view === "list" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									label: "新建",
									onClick: () => {
										setNotice("");
										setView("create");
									}
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
									className: `${Panel_module_css_default.tab}${tab === "match" ? ` ${Panel_module_css_default.tabActive}` : ""}`,
									onClick: () => {
										setTab("match");
										setNotice("");
									},
									children: "匹配"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${Panel_module_css_default.tab}${tab === "archive" ? ` ${Panel_module_css_default.tabActive}` : ""}`,
									onClick: () => {
										setTab("archive");
										setNotice("");
									},
									children: "档案"
								})
							]
						}),
						notice !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Panel_module_css_default.notice,
							children: notice
						}) : null,
						tab === "match" ? matchBody() : tab === "archive" ? archiveBody() : view === "list" ? listBody() : view === "detail" ? detailBody() : createBody(),
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
				label: "Skills",
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