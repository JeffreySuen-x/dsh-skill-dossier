# dsh-skill-manager

DeepSeek Harness（DSH）的技能全生命周期与工作汇报插件：目录浏览、一键填入 `/name` 调用手势、识别建档（10 类方向/使用范围/能力边界/应用场景）、两段式路由、调用统计、保鲜复审、有效性评测触发、文件夹技能停用·重装·删除、临时技能，以及基于 `reporter/brief/` 的日报、月度、复盘与导出。host 半 + 浏览器半（会话头部「管理」按钮）。

## 功能

- **技能目录**：浏览/搜索/详情，一键 `/name` 调用
- **建档（skill_archive）**：给技能写档案，方向为 10 类固定枚举（工程代码/前端视觉/调研报告/内容写作/知识库/记忆会话/多代理编排/本地模型/元技能/命理玄学），持久化到 `<工作区>/.dsh/skill-manager/index.json`；DSH 原生技能（`source === 'bundled'`）拒绝建档
- **匹配（skill_match）**：按任务描述从已建档技能里选最相关候选，支持 `direction` 过滤
- **路由（skill_route）**：两段式——先用关键词命中判方向，再在方向内检索（先分类再检索）
- **使用统计（skill_usage）**：自动记录每个技能被调用的次数与频率
- **保鲜复审（skill_review）**：按「易变方向 + 长期未用 + 从未/久未复审」给待复审技能排序
- **有效性评测（skill_eval / record_eval）**：触发 darwin-skill 在对话框外做「带 vs 不带」对比评测，并把结论写回档案
- **生命周期**：文件夹技能停用（移入 trash，可逆）→ 重装 / 彻底删除
- **临时技能**：严格绑定当前活跃会话，不同会话可持有同名定义且互不可见；会话结束或插件卸载时自动回收
- **工作汇报**：读取 `reporter/brief/YYYY-MM-DD.md` 展示日报/月度，触发复盘并导出 Markdown/JSON；`/api/report` 后端已内置在本包

## 安装（git）

前置：Node `^22.19.0 || >=24.0.0`，已装 DSH（`npx @deepseek-ai/dsh web` 跑过一次即可）。

```sh
dsh plugin --profile web add github:JeffreySuen-x/dsh-skill-manager
```

本仓库**已提交 `lib/` 构建产物**，git 安装即装即用，无需授权构建。管理 host、管理 client 与汇报 host 均由这一个 package 激活，不需要再安装独立的 `@deepseek-ai/dsh-report`。

## 从源码重建

本仓库已自带构建配置（vendored 的 client bundle 预设 + 独立 tsconfig），可脱离 DSH checkout 重建：

```sh
pnpm install        # 拉取构建工具 + 类型依赖（@deepseek-ai/* 为公开包）
pnpm run build      # tsc 产出 lib/types + tsdown 打包 lib/index.js、lib/client.js
pnpm run test       # 单元测试 + manager/report HTTP 集成测试
pnpm run pack:smoke # tarball 临时安装并验证两个 API 路由
```

改完 `src/` 后运行 `pnpm run build` 并提交 `lib/`，即可保证仓库始终自洽（不会出现「改了 src 但 lib 没更新」的隐患）。

GitHub Actions 在 Ubuntu / macOS / Windows 上分别使用 Node 22 和 24 运行 test/typecheck/build/pack 四闸，并在 Windows runner 额外运行 `pnpm run test:windows-smoke`，真实调用 PowerShell + `MoveFileExW` 验证生命周期移动。

## 从旧的双包配置迁移

早期版本把 `/api/report` 放在独立的 `@deepseek-ai/dsh-report` 包，并要求 profile 手工 link/insert。当前版本已将汇报后端并入本包。升级并重启 DSH 前，应从 profile dependencies 与 `cordis.patch.yml` 中移除旧 report 包和 `insert report` 行，避免 `/api/report` 重复注册；`reporter/brief/`、`reporter/Review/` 与 `reporter/export/` 数据目录无需迁移。

> 注意：类型依赖（`@deepseek-ai/cordis` 等）是 type-only、运行时被擦除；若 `pnpm install` 解析不到这些公开包，`pnpm run bundle`（仅 tsdown 打包）仍可独立工作，只是 `tsc` 类型检查跑不了。

## 安装方式（link 即插即用）

本插件是**单一源**（本仓库），直接 `link:` 进 DSH profile 即插即用，无任何副本：

- 主 profile：`~/.dsh/profiles/web/`（dependency `dsh-skill-manager` → link 本仓库；bundles 加 `dsh-skill-manager`）
- 赤水 profile：`自创项目/赤水/data/dsh-home/profiles/web/`（同上）

改完 `src/` 后 `pnpm run build && pnpm run test` 并提交 `lib/`，重启 DSH 即生效（`link:` 指向源码目录，无需再同步任何副本）。

## 平台支持

Windows / Linux / macOS。文件操作（停用/重装/删除）按平台生成 pwsh（Windows）或 bash（Linux/macOS）命令。

## 已知边界

- 插件硬依赖 `webServer` 服务，**仅 web profile**（headless 装不了）。
- Windows 原生回归已写入 CI，但在首次推送并获得 GitHub Actions 绿灯前，仍只能视为「已配置」，不是「已实跑通过」。
- 停用/重装要求技能条目与其 trash 目录位于同一文件系统；若 skill root 本身是独立挂载点，插件会在改动文件前安全拒绝，不执行非原子的 copy-delete。
- Windows 生命周期移动使用原生 `MoveFileExW` 且 flags 为 0：不覆盖已有目标，也不允许跨卷 copy-delete。
- 调用统计是「尽力而为」的观察数据：埋点写入失败会被静默丢弃（不打断技能本身），且只统计本插件运行期间发生的调用，历史调用无法回溯补记。
- 有效性评测（skill_eval）只负责「触发 + 记录结论」，实际的「带 vs 不带」对比评测由 `darwin-skill` 在对话框外完成，本插件不内置评测器。
