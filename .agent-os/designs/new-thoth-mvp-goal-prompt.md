# New Thoth MVP Goal Prompt

Status: Ready to use
Scope: Goal-mode prompt for long-running MVP implementation
Last updated: 2026-07-03

## Prompt

```text
在 `/mnt/cfs/5vr0p6/yzy/thoth` 当前分支 `agent/dev/mvp` 长程推进 New Thoth MVP。不要继续把当前 APP 当作 Paseo-like UI shell 做增量 polish；当前目标从“只实现 UI”升级为“实现最小可验证 MVP 业务链路”。MVP 的 APP 信息架构按 `.agent-os/designs/new-thoth-app-runtime-contract.md`：只有 Settings、Workspace Secretary、Background Tasks 三个用户视图；没有 General Chat。

开始前读：`AGENTS.md`、`.agent-os/project-index.md`、`.agent-os/todo.md`、`.agent-os/run-log.md` 最新条目、`.agent-os/designs/最核心的设计理念.md`、`.agent-os/designs/new-thoth-mvp-user-journey.md`、`.agent-os/designs/new-thoth-app-runtime-contract.md`、`.agent-os/designs/new-thoth-engineering-architecture.md`、`.agent-os/change-decisions.md` 的 `NTH-CD-012/013/014/015/016/020/022/027`。协议代码合同是 `packages/protocol/src/thoth-runtime-contract.ts`。

产品方向：用户主入口是 Workspace Secretary。`New Agent` 必须保留，但语义是当前 workspace 下的新秘书话题/session，不是暴露内部 agent role。用户永远面对秘书；内部 Clarify、PlanExec、Review、provider sessions 都是运行时细节。Settings 配置 provider/permission/daemon/relay/workspace/diagnostics。Background Tasks 展示所有后台 loop task，按 `Goal x/y · Round a/b`、goal 目标/约束/验收、实时 stream、evidence、review verdict 渲染。

运行时方向：Thoth 不做隐藏 LLM API wrapper，也不做本地自然语言智能。所有 AI 能力来自 provider session。Thoth 必须内置隐藏、非可选、跨 provider 兼容的 `thoth.clarify` 和 `thoth.loop` runtime skills。`thoth.clarify` 约束 workspace secretary session；`thoth.loop` 约束后台 PlanExec/Review sessions。每轮 provider 输出必须是 compact packet；daemon 只做 envelope、schema 校验、状态转移、repair、两次确认 gate、permission gate、落盘和 client state broadcast。

必须优先实现的 MVP 链路：Workspace Secretary `C_DIRECT` Quick 前台响应；Quick/Loop 状态切换；`C_TASK_CARD` 第一次后台任务注册确认；`C_GOAL_CARD` 第二次线性 goal 合同确认；`C_REGISTER` 落盘 background task；Background Tasks 对 `L_START/L_WORK/L_REVIEW/L_RETRY/L_GOAL_DONE/L_TASK_DONE/L_BLOCKED` 的最小渲染；packet 不合格时进入 repair/blocker；高风险动作必须通过 permission card。

约束：不恢复旧 Python/plugin/Textual/voice/audio；不隐藏调用通用 LLM API；不靠本地规则假装语义智能；不触碰 Paseo `6767`；保留 Thoth daemon `6688`、Web `8082 -> 8148`、relay test `relay.test.thoth.seeles.ai`；relay pairing token 不得写进 URL query、日志、截图、docs 示例或 final 报告。UI 可以复用现有组件和图标，但当前 scorecard shell 是 rejected legacy baseline，不是目标 IA。

验收：新增/更新 protocol、daemon、driver、client、APP 测试来证明 packet contract、两次确认 gate、Quick 前台、Loop 后台注册、goal/round 渲染和权限阻断行为。至少运行本次改动相关 root gate；基础门禁保持 `npm run check:foundation`。完成后更新 `.agent-os/run-log.md`、`.agent-os/acceptance-report.md`、`.agent-os/project-index.md`、必要的 lessons/todo，并本地 commit；如需 push，更新 `agent/dev/mvp`。
```
