# dsh-skill-manager

你是不是下载过很多skills，但是到用的时候，却总是缺漏？
你是不是坐拥几百种skills，但是却忘记了skills究竟用来做什么？

DeepSeek Harness（DSH）的技能全生命周期管理插件：目录浏览、一键 `/name` 调用、识别建档（方向/使用范围/能力边界/应用场景）、文件夹技能的停用·重装·删除、会话级临时技能。host 半 + 浏览器半（会话头部 `Skills` 按钮）。

## 功能

- **技能目录**：浏览/搜索/详情，一键 `/name` 调用
- **建档（skill_archive）**：给技能写档案，持久化到 `<工作区>/.dsh/skill-manager/index.json`
- **匹配（skill_match）**：按当前任务描述从已建档技能里选最相关候选
- **生命周期**：文件夹技能停用（移入 trash，可逆）→ 重装 / 彻底删除
- **临时技能**：会话级注册/卸载运行时技能

## 安装（git）

前置：Node `^22.19.0 || >=24.0.0`，已装 DSH（`npx @deepseek-ai/dsh web` 跑过一次即可）。

```sh
dsh plugin --profile web add github:JeffreySuen-x/dsh-skill-manager
```

本仓库**已提交 `lib/` 构建产物**，git 安装即装即用，无需授权构建。

## 从源码重建

本仓库已自带构建配置（vendored 的 client bundle 预设 + 独立 tsconfig），可脱离 DSH checkout 重建：

```sh
pnpm install        # 拉取构建工具 + 类型依赖（@deepseek-ai/* 为公开包）
pnpm run build      # tsc 产出 lib/types + tsdown 打包 lib/index.js、lib/client.js
pnpm run test       # 26 条单测
```

改完 `src/` 后运行 `pnpm run build` 并提交 `lib/`，即可保证仓库始终自洽（不会出现「改了 src 但 lib 没更新」的隐患）。

> 注意：类型依赖（`@deepseek-ai/cordis` 等）是 type-only、运行时被擦除；若 `pnpm install` 解析不到这些公开包，`pnpm run bundle`（仅 tsdown 打包）仍可独立工作，只是 `tsc` 类型检查跑不了。

## 平台支持

Windows / Linux / macOS。文件操作（停用/重装/删除）按平台生成 pwsh（Windows）或 bash（Linux/macOS）命令。

## 已知边界

- 插件硬依赖 `webServer` 服务，**仅 web profile**（headless 装不了）。
- 停用/重装/删除在 Windows 上已做代码级跨平台处理，但未在真机验证；见 `output/windows-verification-checklist.md`（仓库外）。
