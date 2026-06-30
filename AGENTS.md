# AGENTS.md

本文件是 New Thoth 仓库的项目操作合同。它面向 Codex、Claude Code 和其他 AI coding agents，目标是让后续长程开发可以从文件恢复，而不是依赖聊天记录。

当前分支来自旧 Thoth plugin 形态的迁移线。旧 plugin runtime 已封存为 archive，不再作为当前实现继续维护。

## 1. Mission

1. New Thoth 是任务控制平面，不是 harness 工具，不是隐藏 LLM API wrapper。
2. 核心产品目标是最大程度降低用户心智负担和使用门槛，把模糊意图编译成可验证、可恢复、可异步执行、可审查的 task loop。
3. 所有 AI/agent 能力必须来自配置的 provider session：ACP adapter、harness runtime、app-server、官方 harness SDK/control surface 或本地 harness CLI。
4. Thoth 自身负责流程、prompt contract、任务 authority、冻结验收、证据、session 记录和多端控制；不得私自调用通用模型 API 替代 provider session。
5. 当前 checkout 是 promoted TypeScript/Node implementation substrate，不是已可运行产品。

## 2. Recovery Order

非平凡任务开始前按顺序恢复上下文：

1. 读本文件。
2. 读 [`.agent-os/project-index.md`](.agent-os/project-index.md)。
3. 读 [`.agent-os/todo.md`](.agent-os/todo.md) 中 top next action 对应条目。
4. 读 [`.agent-os/run-log.md`](.agent-os/run-log.md) 最新条目。
5. 需要理解产品设计时，按顺序读：
   - [`.agent-os/designs/最核心的设计理念.md`](.agent-os/designs/最核心的设计理念.md)
   - [`.agent-os/designs/new-thoth-high-level-design.md`](.agent-os/designs/new-thoth-high-level-design.md)
   - [`.agent-os/designs/new-thoth-mvp-user-journey.md`](.agent-os/designs/new-thoth-mvp-user-journey.md)
   - [`.agent-os/designs/new-thoth-engineering-architecture.md`](.agent-os/designs/new-thoth-engineering-architecture.md)
   - [`.agent-os/designs/new-thoth-prompt-contract-seeds.md`](.agent-os/designs/new-thoth-prompt-contract-seeds.md)
6. 需要执行开发、测试、打包、发布相关工作时，先读 `docs/`：
   - [`docs/development.md`](docs/development.md)
   - [`docs/testing.md`](docs/testing.md)
   - [`docs/packaging.md`](docs/packaging.md)
   - [`docs/release.md`](docs/release.md)

`.agent-os/designs/new-thoth-migration-architecture-20260625.md` 是早期长文归档，只用于追溯，不覆盖 canonical docs。

## 3. Current Truth

1. 项目名：New Thoth。
2. 当前分支：`port/from-old-thoth-plugin`。
3. 技术方向：TypeScript / Node，npm workspaces，`packages/` monorepo。
4. Node/npm：Node `24.14.0`，npm `11.9.0`。
5. License：`AGPL-3.0-or-later`。
6. 当前实现状态：promoted source substrate；foundation packages 必须绿，但 daemon/app/desktop/cli broader runtime 仍 expected-broken，不能声称 MVP 已实现。
7. 旧 plugin archive：
   - Release: `https://github.com/SeeleAI/Thoth/releases/tag/thoth-plugin-final-archive`
   - Branch: `archive/main-20260627`
8. `.agent-os/upstreams/` 是 ignored local raw cache，不是项目 authority，不得 stage/commit。
9. `.dev/` 是 ignored local toolchain/artifact area，不得 stage/commit。

## 4. Authority And Docs Split

`.agent-os/` 是项目 authority 和证据账本：

1. `project-index.md`: 当前真相、唯一 top next action、阻塞和恢复入口。
2. `requirements.md`: 用户锁定目标、硬约束、验收标准、非目标。
3. `change-decisions.md`: 用户后续拍板的 append-only 记录。
4. `architecture-milestones.md`: workstreams、milestones、验收边界。
5. `todo.md`: backlog / ready / doing / blocked / done / verified / abandoned。
6. `acceptance-report.md`: 通过与未通过的证据。
7. `lessons-learned.md`: 失败探索、陷阱、重试条件。
8. `run-log.md`: 最近工作会话记录。
9. `designs/`: 产品、用户旅程、架构和 prompt contract authority。

`docs/` 是可执行开发手册。它解释怎么开发、怎么测试、怎么打包、怎么发布，但不得悄悄改写 `.agent-os/` 中的目标、决策或验收含义。

## 5. Package Map

Root workspaces 必须保持 `["packages/*"]`，正式 package 只能是以下 10 个：

1. `packages/protocol`: wire schemas、message types、binary frames、compatibility contract。
2. `packages/client`: daemon/relay client SDK；不拥有产品 authority。
3. `packages/core`: headless authority/runtime domain logic；无 UI，无 provider direct calls。
4. `packages/daemon`: local authority runtime、workspace/session orchestration、provider process coordination。
5. `packages/drivers`: harness/provider adapters；无 task authority。
6. `packages/tui`: OpenTUI shell only。
7. `packages/app`: Expo/React Native mobile/web app shell。
8. `packages/desktop`: Electron shell and packaging wrapper。
9. `packages/relay`: zero-knowledge E2EE relay substrate。
10. `packages/cli`: command surface and automation entry。

`packages/app/highlight` 是 nested package，不是第 11 个 root workspace。

每个 package 都有自己的 `AGENTS.md` 和 `CLAUDE.md -> AGENTS.md`，编辑 package 内文件时必须遵守局部合同。

## 6. Non-Negotiable Rules

1. 不允许在没有用户决定的情况下改写 New Thoth 核心目标、约束或验收含义。
2. 长期跟踪条目必须使用 New Thoth ID，例如 `NTH-OBJ-001`、`NTH-REQ-001`、`NTH-MS-001`、`NTH-TD-001`、`NTH-EV-001`、`NTH-CD-001`。
3. 没有证据不得声称完成、通过、已实现或满足目标。
4. `done` 不等于 `verified`；实现、验证、文档记账都完成后才能关闭 TODO。
5. 失败探索必须保留在 `lessons-learned.md`，不能为保持整洁而删除。
6. `project-index.md` 中必须始终只有一个全局 top next action。
7. 项目状态文档主语言为中文；代码注释与脚本输出使用英文。
8. 不允许重新引入旧 Python runtime、旧 Claude/Codex plugin projection、旧 dashboard template 或旧 Textual TUI。
9. `packages/tui` 必须使用 OpenTUI；不得引入 Textual 或旧 plugin TUI。
10. Voice、speech、dictation、audio 不是当前 MVP 产品能力；不得新增权限、依赖、UI 或 runtime 能力。
11. Multica 源码禁止 copy 到本仓库。Multica 只能作为设计和工程治理参考。
12. 不得 stage/commit `.agent-os/upstreams/`、`.agent-os/artifacts/`、`.dev/`、`packages/app/android/`、`packages/app/ios/`。

## 7. Command Discipline

1. Root `package.json` scripts 是唯一标准入口。
2. 不直接运行 `npx oxfmt`、`npx oxlint`、`npx vitest`、`npx tsc` 作为常规流程；通过 root npm scripts 调用。
3. 允许为了定位 root script 失败而临时运行底层命令，但 final/update 必须说明这是 debug，不是正式 gate。
4. 不默认运行全仓重型测试。优先 narrow checks；handoff 前至少运行和本次改动相关的 root gate。
5. 当前基础门禁是 `npm run check:foundation`。
6. Foundation gate 失败时必须先修复，不继续做业务代码。
7. `npm install` 受 root `.npmrc` 约束，默认 `ignore-scripts=true`、`audit=false`、`fund=false`；需要 native/toolchain 初始化时必须通过显式 root script 完成。

## 8. Test And Verification Discipline

1. Tests prove behavior, not implementation shape.
2. 行为变更优先写或更新正确层级的测试。
3. Unit tests 使用 `*.test.ts(x)`；真实 provider tests 使用 `*.real.e2e.test.ts` 或明确 real-provider project；local resource tests 使用 `*.local.e2e.test.ts`。
4. Real provider tests 不进入默认 foundation gate。
5. 不因为 flaky 删除测试；先定位 variance 来源。
6. 不给 provider auth 写假测试。Provider 自己处理 auth，Thoth 测 provider boundary 和 permission/event behavior。
7. 不声称检查通过，除非本轮实际运行并记录命令结果。

## 9. Boundary And State Rules

1. `protocol` owns wire shape and compatibility. New fields should be optional/defaultable;不要破坏旧 client/daemon parsing。
2. `client` owns daemon/relay transport and SDK facade；不得拥有 task authority。
3. `core` owns headless domain logic；不得依赖 React Native、Electron、DOM、provider SDK 或 daemon process globals。
4. `daemon` owns local runtime authority and persistence；不得隐藏调用 LLM API。
5. `drivers` owns provider adapters；provider session handles、permissions、model settings 是 execution evidence/resume metadata，不是 task authority。
6. `app` and `desktop` are shells. UI state belongs in UI packages; durable task authority belongs in daemon/core/protocol flow.
7. WebSocket/provider events may patch client state, but task truth must come from authority store and recorded evidence.
8. Every package must directly declare external packages it imports.

## 10. Packaging Discipline

1. Android Debug APK is a local infrastructure artifact, not a release.
2. Android toolchain lives under ignored `.dev/`.
3. Generated native folders `packages/app/android/` and `packages/app/ios/` stay ignored.
4. iOS build requires macOS/Xcode. Linux scripts must fail or skip clearly without implying success.
5. Release/publish/tag/push requires explicit user authorization. A release preview is not authorization.

## 11. Escalation Conditions

仅在以下情况升级给用户：

1. 必须由用户拍板的目标、边界、license、分支或资源决策。
2. 硬外部阻塞导致无法推进。
3. 多条探索路径连续失败，项目明显停滞。
4. 当前 checkout 事实与 canonical docs 出现无法自行化解的高影响冲突。
5. 执行发布、push、tag、云构建、商店提交或系统级安装前。

## 12. Update Discipline

发生以下事件时必须更新相应状态文档：

1. 新建 TODO。
2. TODO 状态变化。
3. blocker 出现或消失。
4. milestone 完成或重排。
5. 新证据产生。
6. 探索失败或被放弃。
7. 一次 autonomous 工作会话结束。

最小要求：

1. 工作会话结束前更新 `run-log.md`。
2. top next action 改变时更新 `project-index.md`。
3. 用户拍板改变解释边界时更新 `change-decisions.md`。
4. 新增或重核外部资料时更新 `.agent-os/official-sources/platform-index.md`。

## 13. 通用工程行为准则

以下规则整合自 `multica-ai/andrej-karpathy-skills` 的工程准则，并按 New Thoth 当前仓库语境收敛。若与本文件前文的项目真相、用户决定或 New Thoth design authority 冲突，以上文和用户当轮指令为准。

### 13.1 Think Before Coding

不要假设，不要掩饰困惑，先暴露关键权衡。

1. 实施前先明确关键假设。
2. 如果存在多个合理解释，不要静默选择一个；应把分歧点说清楚。
3. 如果更简单的方案已经足够，应主动指出。
4. 如果信息不清晰，应先说明卡点，而不是带着模糊理解继续实现。
5. 对很小、很明确的任务，可以保持轻量判断；不要为了形式主义制造流程负担。

### 13.2 Simplicity First

只写解决当前问题所需的最小代码或文档，禁止投机式扩展。

1. 不实现用户未要求的功能。
2. 不为一次性逻辑提前抽象。
3. 不引入未被要求的可配置性、灵活性或兼容层。
4. 不为不可能或未成立的场景添加噪音式错误处理。
5. 如果实现明显比问题本身更复杂，应回退到更小方案。

### 13.3 Surgical Changes

只改必须改的地方，只清理自己引入的问题。

1. 编辑现有实现或文档时，不顺手重构无关代码、注释、格式或结构。
2. 保持周边文件既有风格，除非用户明确要求统一或当前风格已被新版 reset 决策替换。
3. 只删除因本次修改而变成未使用的导入、变量、函数、文件或文档段落。
4. 如果发现既有死代码、旧文档漂移或相邻问题，可以记录或报告，但不要借机扩大改动面。
5. 每一行变更都应能直接追溯到当前请求、当前 TODO 或当前 design authority。

### 13.4 Goal-Driven Execution

先定义可验证成功条件，再循环到验证通过。

1. 将“修一下”“支持一下”“整理一下”这类宽泛请求翻译成可核验目标。
2. 多步任务默认采用“步骤 -> 验证方式”的思维。
3. 对 bugfix，优先形成可复现证据，再修复并复验。
4. 对重构，优先保护既有行为和测试边界，避免把重写伪装成整理。
5. 对 New Thoth substrate 工作，必须明确区分“目录/文档/门禁已落地”和“产品能力已实现”；不得用基础设施验证替代 MVP 行为验证。

推荐的最小计划格式：

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```
