# New Thoth UI Goal Prompt

Status: Ready to use
Scope: Goal-mode prompt for long-running UI implementation
Last updated: 2026-07-02

## Prompt

```text
在 `/mnt/cfs/5vr0p6/yzy/thoth` 当前分支 `agent/dev/ui` 长程推进 New Thoth 完整多端 UI 产品化。不要兜底、不要 mock/debug UI、不要半截 demo；目标是 Web、Desktop、OpenTUI 三端都成为真实 dogfood 入口，完整覆盖 Thoth 的最终功能表面、状态表达、初次设置、交互引导、错误恢复、provider/relay/workspace/task/evidence 用户路径。后端业务未完全实现没关系，但 UI 不能撒谎，必须诚实显示 preview/unavailable/needs provider/needs workspace/needs pairing。

开始前读：`AGENTS.md`、`packages/tui/AGENTS.md`、`.agent-os/project-index.md`、`.agent-os/todo.md`、`.agent-os/run-log.md` 最新条目、`.agent-os/designs/最核心的设计理念.md`、`.agent-os/designs/new-thoth-ui-shell-rebrand-plan.md`、`.agent-os/designs/new-thoth-mvp-user-journey.md`、`.agent-os/change-decisions.md` 的 `NTH-CD-008/020/022/024/026`。Web/Desktop 图标只用 `packages/app/assets/icons/arcade-inventory/` 的 52 个透明 PNG，不再生成候选图。TUI 必须基于 OpenTUI，不得使用 Textual/旧 plugin TUI。

Thoth 不是 Paseo 换皮，不是 harness 工具箱，不是隐藏 LLM API wrapper。UI 必须体现 One Thoth、任务控制平面、私人秘书式工作界面。用户打开 Web/Desktop 或从 CLI 进入 OpenTUI 时，应立即感知这是独立 Thoth：轻度游戏化、轻松可爱、有引导、有状态、有下一步，同时仍是高效率工作产品。

必须完成：Home/One Thoth、Workspace、Task/Loop、Providers、Connections/Devices/Relay、Evidence/Review、Settings/About、onboarding、空态、错误态、恢复态。Workspace 是核心工作面：workspace identity、provider readiness、composer、Mode/Clarify/Loop、active task、timeline/evidence preview、context/files 入口。Composer 固定为 `+`、Provider、Mode、Clarify、Loop；Mode=Quick/Loop；Clarify=Auto/Don’t Ask/Light/Balanced/Dive Dive Dive；Loop=Auto/Single Pass/Light/Balanced/Try Try Try，Quick 下 Loop 灰显。`+` 只表达图片和小文件，MVP 小于 10MB；scope 通过 `@`。

OpenTUI 与 Web/Desktop 同等对待，使用同一 daemon/protocol/client/API，不许走 mock backend、临时文件或命令旁路。从任意 workspace 的 `pwd` 通过 CLI 启动后，应直接进入对应 workspace；未注册时在 TUI 内完成注册/连接/配置引导。TUI 必须有可发现导航、焦点管理、返回/退出、错误恢复、窄/宽终端布局，不能做成 debug log viewer 或难记命令集合。

约束：不恢复旧 Python/plugin/Textual/voice/audio；不隐藏调用 LLM API；不靠本地规则假装语义智能；不触碰 Paseo `6767`；保留 Thoth daemon `6688`、Web `8082 -> 8148`、relay test `relay.test.thoth.seeles.ai`、workspace/fresh pairing/expired credential/`hi` 不白屏路径。

严格验收：Web/Desktop/OpenTUI 均覆盖功能表面且非空白占位；`npm run build:web`、open-project/workspace/hi/fresh relay/expired relay smoke、Desktop dev 或 packaged smoke、OpenTUI CLI workspace smoke、`npm run check:foundation`、`npm run format:check`、`git diff --check` 通过。做 Playwright UI 压测和 PTY/OpenTUI 压测：快速切页、反复打开设置、切换 Mode/Clarify/Loop、workspace/provider/relay/onboarding/刷新恢复、窄屏宽屏窄终端宽终端，不得白屏、异常、重叠、溢出、死路、卡死、焦点丢失或乱码。

建立 `docs/ui-review-scorecard.md` 或写入 `.agent-os/acceptance-report.md`：Web/Desktop/OpenTUI 分别评分并给综合分。100 分参考 Apple 顶级产品 UI；综合美学与交互 >90 才通过，OpenTUI 单项不得低于 88。维度：视觉一致性、信息架构、轻度游戏化品味、可爱但不幼稚、效率、onboarding、状态/错误恢复、跨 viewport/terminal、Thoth 识别度、Paseo 去除、多端语义一致。保存并引用关键截图/终端截图。完成后更新 `.agent-os/run-log.md`、`.agent-os/acceptance-report.md`、必要的 project-index/todo，并本地 commit；如需 push，用 repo-local Royalvice token 更新 `agent/dev/ui`。
```
