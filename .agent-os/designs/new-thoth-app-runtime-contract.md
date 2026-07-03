# New Thoth App Runtime Contract

## Status

1. 日期：`2026-07-03`
2. 性质：New Thoth APP 信息架构、内置 runtime skill 与 packet 合同
3. 适用范围：`packages/app`、`packages/desktop`、`packages/daemon`、`packages/drivers`、`packages/protocol`、`packages/client`
4. 代码合同：`packages/protocol/src/thoth-runtime-contract.ts`
5. 状态：canonical design authority；当前 UI shell 尚未实现本合同
6. 取代范围：本文件取代此前围绕 General Chat / Today dashboard / Paseo-like shell 的 APP UI 方向；更早 user journey 中仍有效的任务生命周期、provider 边界、权限和证据原则继续有效

## 1. 核心判断

New Thoth APP 不是 dashboard，不是 Paseo 换皮，不是 agent/session 管理器。

APP 的产品模型是：

1. 用户进入某个 workspace。
2. 用户面对该 workspace 的秘书。
3. `New Agent` 表示为该 workspace 开一个新的秘书话题/session。
4. 用户在这个秘书 session 中用 `Quick` 处理前台小事，用 `Loop` 注册后台任务。
5. 只要注册后台 Loop，就必须经过两次用户确认。
6. 后台任务进入独立后台任务视图，按线性 goal 和 loop round 展示。
7. Settings 负责配置所有东西，但不参与日常任务流。

用户不需要理解 Clarify provider session、PlanExec session、Review session、skill、packet、state code、repair、authority store、driver 或 runtime。

Thoth 内部必须理解这些，并用代码合同和 daemon 校验机械保证。

## 2. APP 只有三个用户视图

### 2.1 设置视图

设置视图配置所有系统能力：

1. provider、model、runtime、thinking、fast mode。
2. permission mode、full access / trust mode。
3. daemon 状态。
4. relay / device pairing。
5. workspace 管理。
6. diagnostics。
7. 内置 runtime skill 版本。
8. about。

设置视图可以显示 `thoth.clarify` 和 `thoth.loop` 已安装，但不能让用户选择或关闭它们。

### 2.2 Workspace 秘书视图

Workspace 秘书视图是用户主入口。

视图职责：

1. 展示当前 workspace。
2. 展示该 workspace 下的秘书 session 列表。
3. 保留 `New Agent` 入口。
4. 在当前秘书 session 中展示聊天流、clarify card、task card、goal card、permission card、registered card。
5. 允许用户用 composer 切换 `Quick` / `Loop`、Clarify 强度、Loop 强度。
6. 在 Loop 注册后显示后台 task 链接。

`New Agent` 的产品含义：

1. 不是让用户选择内部 agent。
2. 不是暴露 PlanExec / Review / provider role。
3. 是为当前 workspace 开一个新的秘书话题/session。
4. 每个话题有独立 provider session 上下文。
5. 用户面对的仍然是秘书。

真实关系：

1. 用户永远面对 workspace secretary session。
2. secretary session 受 `thoth.clarify` skill 约束。
3. 后台 PlanExec / Review sessions 受 `thoth.loop` skill 约束。
4. Thoth daemon 只按 packet 和状态码推进 authority。

### 2.3 后台任务视图

后台任务视图展示所有正在 Loop 中的任务。

列表卡片必须显示：

1. task title。
2. workspace。
3. 总目标摘要。
4. 总约束摘要。
5. 总验收摘要。
6. 当前 `Goal x / y`。
7. 当前 `Round a / b`。
8. 是否需要用户处理。
9. 当前状态。

详情页必须显示：

1. 总目标、约束、验收。
2. 线性 goals。
3. 每个 goal 的目标、约束、验收。
4. goal 状态：pending、running、reviewing、passed、blocked。
5. passed goal 显示绿色。
6. running goal 显示转圈。
7. 当前 goal 可展开实时 provider stream。
8. evidence、changed files、review verdict、permission request。

后台任务视图不是 raw log viewer。默认展示 CEO 可理解的目标、约束、验收和状态；细节按需展开。

## 3. Quick 和 Loop 的切换

Quick 和 Loop 不是两个页面，而是同一个 workspace secretary session 的运行状态。

一个 session 中允许：

1. 从 Quick 开始。
2. 中途切换到 Loop。
3. 经过两次确认后注册后台 task。
4. 当前 secretary session 回到 Quick。
5. 用户继续在同一个 session 中前台聊天。
6. 后续再从同一个 session 注册另一个后台 task。

稳定切换靠 packet，不靠前端猜测，也不靠自然语言上下文猜测。

每一轮 provider 输入都由 Thoth envelope 标定：

1. workspace。
2. secretary session。
3. mode。
4. clarify strength。
5. loop strength。
6. state code。
7. 是否需要注入 skill prompt。
8. 用户原始输入。
9. 期望输出 packet 类型。

每一轮 provider 输出都必须是合格 packet。Thoth daemon 不采信裸自然语言作为 authority。

## 4. 内置 runtime skills

New Thoth 必须内置两个 runtime skills：

1. `thoth.clarify`
2. `thoth.loop`

这两个 skill：

1. 随 Thoth 安装。
2. 对用户不可见。
3. 不可选、不可关闭。
4. 不是 Paseo 那种用户选择 skill。
5. 必须对各 provider 兼容。
6. 是 provider runtime 的 Thoth 约束层。

Thoth 本身不提供 AI 智能。智能来自 provider session。

Thoth 的保证来自两层：

1. runtime 植入：通过内置 skill 约束 provider session 行为。
2. daemon 机制：通过 packet schema、状态转移、用户确认 gate、权限 gate 和 repair loop 机械保证。

### 4.1 Clarify skill

`thoth.clarify` 作用于 workspace secretary session。

它负责：

1. Quick 直接响应。
2. 必要时问黄金问题。
3. 生成第一次后台任务注册确认卡。
4. 生成第二次线性 goal 拆分确认卡。
5. 输出最终后台任务注册 packet。
6. 在 packet 不合格时按 `C_REPAIR` 修复格式。

Quick + no clarify 也必须处在 `thoth.clarify` 约束下。此时状态码告诉 skill 不要澄清，像普通 provider 一样回答或执行。

如果下一轮状态未变化，不重复注入完整 skill prompt；只传轻量 envelope。若 mode、clarify 强度、loop 强度、state code 或 schema 变化，则注入 state refresh。

### 4.2 Loop skill

`thoth.loop` 作用于后台 PlanExec 和 Review provider sessions。

它负责：

1. 读取当前 goal 的目标、约束、验收。
2. 只推进当前 goal。
3. 输出进度和证据。
4. 遇到高风险动作时输出权限请求。
5. Review 时只审查，不修改 workspace。
6. Review 失败时输出失败原因、下一轮变化和禁止重复事项。
7. goal 通过时输出 summary。
8. task 完成或阻塞时输出 summary / blocker。

PlanExec 仍然由 provider 的能力完成，Review 仍然是独立 provider session。Loop skill 只定义状态码、行为边界和 packet 输出规范。

## 5. 两次确认 gate

凡是从前台 secretary session 注册后台 Loop，必须经过两次用户确认。

### 5.1 第一次确认：Task Card

状态码：`C_TASK_CARD`

目的：CEO 级整体审批，回答“这件事是否值得注册为后台任务”。

只展示：

1. title。
2. goal。
3. constraints。
4. acceptance。
5. risk。

不能在这里拆执行计划。

用户动作：

1. 注册为后台任务。
2. 保持 Quick。
3. 修改。
4. 取消。

### 5.2 第二次确认：Goal Card

状态码：`C_GOAL_CARD`

目的：秘书把大 task 拆成线性、可独立 loop 的 goals。

每个 goal 只允许包含：

1. title。
2. goal。
3. constraints。
4. acceptance。

不能写 implementation plan。具体执行计划由后续 PlanExec session 自己拆。

用户确认后才进入 `C_REGISTER`，Thoth daemon 才落盘 task 和 goals。

## 6. 状态码合同

状态码是 skill 的索引号。

Provider 看到状态码，必须能从对应 skill 文档中知道这一轮该干什么、输出什么。

Thoth daemon 看到状态码，必须能机械校验 packet、推进状态、渲染 UI 或进入 repair。

### 6.1 Clarify codes

Clarify codes 固定为 7 个：

```text
C_DIRECT
C_ASK
C_TASK_CARD
C_GOAL_CARD
C_REGISTER
C_BLOCKED
C_REPAIR
```

含义：

1. `C_DIRECT`: Quick 直接响应；不要澄清，不要注册后台任务。
2. `C_ASK`: 问黄金问题；只问会改变方向、风险或验收的问题。
3. `C_TASK_CARD`: 输出第一次后台任务注册确认卡。
4. `C_GOAL_CARD`: 输出第二次线性 goal 拆分确认卡。
5. `C_REGISTER`: 输出最终可落盘后台任务 packet。
6. `C_BLOCKED`: 无法继续，说明缺什么和需要用户做什么。
7. `C_REPAIR`: 只修 packet 格式，不改变用户意图。

### 6.2 Loop codes

Loop codes 固定为 8 个：

```text
L_START
L_WORK
L_NEED_PERMISSION
L_REVIEW
L_RETRY
L_GOAL_DONE
L_TASK_DONE
L_BLOCKED
```

含义：

1. `L_START`: 开始一个 goal 或一个新 round。
2. `L_WORK`: PlanExec 正在推进当前 goal。
3. `L_NEED_PERMISSION`: 需要权限，必须停止高风险动作。
4. `L_REVIEW`: Review 阶段，只审查，不修改 workspace。
5. `L_RETRY`: Review 未通过但可重试；必须说明失败、变化和避免重复。
6. `L_GOAL_DONE`: 当前 goal 通过。
7. `L_TASK_DONE`: 所有 goals 完成。
8. `L_BLOCKED`: 无法继续，需要用户决定。

## 7. Packet 合同

Clarify 和 Loop 使用同一个顶层 packet 形态。顶层字段固定为 8 个：

```json
{
  "type": "clarify",
  "code": "C_DIRECT",
  "session_id": "sec_123",
  "task_id": null,
  "content": {},
  "ui": {},
  "next": "C_DIRECT",
  "errors": []
}
```

字段：

1. `type`: `clarify` 或 `loop`。
2. `code`: 当前输出状态码。
3. `session_id`: 当前 secretary / loop provider session。
4. `task_id`: 已关联后台任务时填写，否则为 `null`。
5. `content`: daemon 落盘、状态推进和 evidence 需要的结构化内容。
6. `ui`: 前端直接渲染需要的信息。
7. `next`: 下一轮建议状态码。
8. `errors`: agent 自报异常；正常为空数组。

不允许新增顶层字段。需要扩展时优先放进 `content` 或 `ui`，并在 protocol contract 中新增 schema。

### 7.1 Clarify UI kinds

```text
message
quick_receipt
clarify_card
task_registration_card
goal_contract_card
registered_card
blocked_card
packet_error
```

### 7.2 Loop UI kinds

```text
goal_started
progress
permission_card
review_card
retry_card
goal_done
task_done
blocked_card
packet_error
```

### 7.3 Loop cursor

除 `L_TASK_DONE` 外，Loop packet 的 `content.cursor` 必须存在：

```json
{
  "goal": 2,
  "goals": 5,
  "round": 1,
  "rounds": 3
}
```

含义：

1. `goal`: 当前第几个 goal，从 1 开始。
2. `goals`: goal 总数。
3. `round`: 当前 goal 的第几轮 loop。
4. `rounds`: 当前 goal 最大轮数；`Run Until Stopped` 可为 `null`。

前端后台任务视图用它渲染：

```text
Goal 2 / 5 · Round 1 / 3
```

Daemon 必须拒绝：

1. `goal > goals`。
2. `round > rounds`，除非 `rounds = null`。
3. 缺失 cursor 的 active Loop packet。

## 8. Provider input envelope

每轮 provider 输入也必须被 Thoth envelope 包装。顶层字段固定为：

```json
{
  "type": "provider_input",
  "skill": "thoth.clarify",
  "session_id": "sec_123",
  "task_id": null,
  "code": "C_DIRECT",
  "controls": {
    "mode": "quick",
    "clarify": "none",
    "loop": null
  },
  "input": "hi",
  "inject": "none",
  "expect": "clarify"
}
```

规则：

1. `skill = thoth.clarify` 时，`code` 必须是 Clarify code，`expect` 必须是 `clarify`。
2. `skill = thoth.loop` 时，`code` 必须是 Loop code，`expect` 必须是 `loop`。
3. `inject = none` 表示当前 provider session 已有 skill 上下文，且状态未变化。
4. `inject = state_refresh` 表示 mode、strength、code 或 schema 变化，需要刷新 skill 状态。
5. `inject = full` 只用于 session bootstrap 或 provider 丢失上下文后的恢复。

## 9. Daemon 机械责任

Thoth daemon 不做 AI 判断。它只做机械责任：

1. 构造 provider input envelope。
2. 决定 `inject` 是 `none`、`state_refresh` 还是 `full`。
3. 发送给 provider session。
4. 接收 provider output packet。
5. 校验 JSON、schema、code、ui.kind、next、cursor。
6. 校验两次确认 gate。
7. 校验权限 gate。
8. 校验 Review 通过后才能 `L_GOAL_DONE`。
9. 校验所有 goals 完成后才能 `L_TASK_DONE`。
10. packet 不合格时，用 `C_REPAIR` 或对应 repair request 让 provider 修格式。
11. 多次 repair 失败后，向用户显示 packet error / blocked card。
12. 合格 packet 落盘并广播给 clients。

Daemon 不允许：

1. 用本地自然语言启发式判断用户意图。
2. 私自调用通用 LLM API。
3. 用 provider 自然语言自报替代 packet。
4. 跳过用户两次确认创建后台 task。
5. 跳过权限卡执行高风险动作。

## 10. 前端渲染责任

前端不理解 AI，不解释 provider 原始行为。

前端只根据：

1. `type`
2. `code`
3. `ui.kind`
4. `content`

渲染：

1. Workspace 秘书视图中的消息、澄清卡、任务注册卡、goal 合同卡、注册成功卡、阻塞卡。
2. 后台任务视图中的 goal 状态、round 状态、progress、permission、review、retry、done、blocked。
3. Settings 中的 provider / permission / daemon / device / runtime skill 信息。

前端不得：

1. 从自然语言里推断任务状态。
2. 自己决定 Quick 是否升级 Loop。
3. 自己创建后台 task authority。
4. 把 provider session handle 当成 task truth。

## 11. 当前 UI 的处理结论

当前 Web/Desktop APP UI shell 证明了一些工程能力：可构建、可截图、可连接 daemon、可显示 workspace/provider/relay 状态。

但它不是最终 New Thoth APP UI 方向。

问题：

1. 仍然太像 Paseo 的 workspace/session/settings shell。
2. 首页/scorecard 仍以页面完整性为中心，而不是 secretary session 与后台 loop。
3. `New Agent` 的语义还没有收敛成 workspace secretary topic。
4. Quick / Loop 还没有 packet 化切换。
5. 后台任务视图还不存在。
6. Clarify / Loop runtime skills 还不存在。

后续 APP 重构必须从本文件出发，不从当前 UI shell 继续增量 polish。

## 12. 最小实现顺序

推荐顺序：

1. 使用 `packages/protocol/src/thoth-runtime-contract.ts` 作为 code authority。
2. 在 `packages/daemon` 中实现 packet validator、repair loop 和两次确认 gate。
3. 在 `packages/drivers` 中实现 `thoth.clarify` / `thoth.loop` skill 注入机制。
4. 在 APP 中重构三个视图：Settings、Workspace Secretary、Background Tasks。
5. 在 Workspace Secretary 中实现 `New Agent` 作为新秘书话题/session。
6. 接入 `C_DIRECT` Quick 前台路径。
7. 接入 `C_TASK_CARD` -> `C_GOAL_CARD` -> `C_REGISTER` 后台任务注册路径。
8. 接入 Background Tasks 的 `L_START` / `L_WORK` / `L_REVIEW` / `L_GOAL_DONE` 渲染。

每一步都必须保持文案诚实：没有实现的 runtime 能力不能用 preview 卡假装已经可用。
