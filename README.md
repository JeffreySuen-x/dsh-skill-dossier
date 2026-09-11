# dsh-skill-dossier

[English](./README.en.md) · 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的**技能档案与工作汇报**插件：把散在 `~/.dsh/skills`、`.dsh/skills`、`~/.agents/skills` 里的技能收成一份**可读、可核对、可保鲜**的档案，并把每天的工程简报汇成日报/月度/复盘。

一个包，三个板块：

| 板块 | 做什么 |
|---|---|
| **技能** | 浏览、搜索、看详情、一键把 `/name` 填进输入框；文件夹技能的停用（进 trash，可逆）· 重装 · 彻底删除；会话级临时技能试写 |
| **档案** | 每个技能的**档案**：方向（10 类）、使用范围、能力边界、应用场景、来源标注、调用统计、**实测成败**、**目录 token 成本**、保鲜复审、评测结论 |
| **汇报** | 读 `reporter/brief/YYYY-MM-DD.md` 出日报/月度；**复盘**（按名调用 skill、可追踪、可停止跟踪）、结构化产物、**回写 brief**、导出 md/json、可选的定时复盘 |

> 汇报是**可选模块**：`dataRoot` 可配置，默认读工作区里的 `reporter/brief/`；不去用就只是一块没人点的面板，不影响技能与档案。

## 为什么是「档案」

同类插件大多止步于「列出来、开/关」。本插件多走一步：**给技能建档，并且用实测而不是模型自述来核对它**。

- **档案字段**：方向 / 使用范围 / 能力边界 / 应用场景 / 来源（自创·外来·系统·未标注）/ 建档时间 / 复审时间 / 正文哈希
- **实测成败**：监听 DSH 官方的 `tools/result` 事件，`skill` 工具加载成功记 ✅、失败记 ❌ 并留下错误原因——不是「模型说它有用」，而是「它到底跑起来没有」
- **评测结论**：`record_eval` 写回 score(0-10) / baselineDelta / 有效·无效·待评测，与实测互补（一个说「跑起来了吗」，一个说「有用吗」）
- **目录成本**：估算每个技能名称+描述常驻系统提示的 ≈token 数，回答「谁最占上下文」
- **保鲜复审**：按「易变方向 + 长期未用 + 久未复审」排序，直接告诉模型或人「该复审哪几个」

## 安装

前置：Node `^22.19.0 || >=24.0.0`，已装 DSH（`npx @deepseek-ai/dsh web` 跑过一次即可）。

```sh
# npm
dsh plugin --profile web add dsh-skill-dossier

# GitHub
dsh plugin --profile web add github:JeffreySuen-x/dsh-skill-dossier

# 本地目录（开发用）
dsh plugin --profile web add link:/绝对路径/dsh-skill-dossier
```

本仓库**已提交 `lib/` 构建产物**，git 安装即装即用，不需要授权构建脚本。

## 模型侧工具

| 工具 | 作用 |
|---|---|
| `skill_archive` | 为技能写档案（方向/使用范围/能力边界/应用场景/来源） |
| `skill_review` | 列出待复审技能（保鲜信号排序） |
| `record_eval` | 把评测结论（score / baselineDelta / 结论）写回档案 |

> 早期版本的 `skill_match` / `skill_route` / `skill_usage` / `skill_eval` 已移除：DSH 把技能目录（名称+描述）直接放进系统提示，由模型自己选，插件再叠一层词法路由没有实测收益（本机 8 周实测：`skill` 工具调用 233 次，`skill_match` 0 次、`skill_route` 1 次）。数据仍照记，只是不再单开面板与工具。

## 配置

插件 config 全部有默认值，不配置 = 旧行为。写在 profile 的 `cordis.patch.yml` 里按 `id: skill-dossier` 覆盖：

```yaml
- id: skill-dossier
  config:
    report:
      dataRoot: reporter        # 汇报数据根目录
      briefDir: brief           # 每日简报目录
      reviewDir: Review         # 复盘产物目录
      exportDir: export         # 导出目录
      reviewSkill: aeon-review  # 复盘按名加载的 skill（留空则只用内联步骤）
      dispatch: session         # session | subagent（复盘是否派给子代理）
      runTimeoutMs: 600000      # 单次复盘等产物的上限
      schedule:
        enabled: false          # 定时复盘，默认关闭
        hour: 22                # 当天几点之后才触发
        checkMinutes: 30        # 每多少分钟检查一次
```

注意：DSH 的 patch 层是**整体替换** config 而不是合并，所以覆盖时请把要改的键写全（未写的键会走代码里的默认值）。

## 从源码重建

```sh
pnpm install        # 拉构建工具 + 类型依赖（@deepseek-ai/* 为公开包）
pnpm run build      # tsc 产出 lib/types + tsdown 打包 lib/index.js、lib/client.js
pnpm run test       # 单元 + 集成测试
node qa/gates.mjs   # test / typecheck / build / pack 四闸
```

改完 `src/` 后运行 `pnpm run build` 并提交 `lib/`，保证仓库自洽（CI 用 `git diff --exit-code -- lib` 防漂移）。

## 平台支持

Windows / Linux / macOS。文件生命周期操作按平台生成 pwsh（Windows，用原生 `MoveFileExW`）或 bash（POSIX）命令；`tests/windows-runtime.spec.ts` 在 Windows runner 上真机调用验证。

## 已知边界

- **仅 web profile**：host 半硬依赖 `webServer` 服务，headless 装不了。
- **调用统计是观察数据**：只统计插件运行期间发生的调用，历史调用无法回溯补记。埋点写盘失败不会打断技能本身，但**不再静默**——面板顶部会显示「调用统计写盘失败」及原因。
- **复盘的完成判据是产物落盘**，不是「某一轮对话结束了」。DSH 的 prompt 回执不等于 turn 结束，靠 MessageId 关联轮次在并发工作时会串台，所以本插件只问一件事：入队前后产物内容变了没有。代价是：agent 什么都没写时，要等满 `runTimeoutMs` 才报超时。
- **「停止跟踪」不等于中断**：它会停止状态跟踪并记账，但**不会**打断 agent 已在执行的那一轮。
- **定时复盘只在 DSH 进程存活期间生效**，且需要该工作区最近有过会话；无当天新增内容不触发，错过不补跑。默认关闭。
- **生命周期移动要求同文件系统**：技能条目与 trash 目录跨挂载点时会在改文件前安全拒绝，不做非原子的 copy-delete。
- **Windows/Linux 回归已写入 CI**，但只有在 GitHub Actions 真绿之后才算「实跑通过」。
- 复盘的结构化产物（`<reviewDir>/<date>.json`）**写入时校验**：七个键必须齐全且不得多键；不合约就回退渲染 markdown，不会因为契约漂移白屏。

## 许可

MIT
