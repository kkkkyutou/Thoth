# Thoth MVP Loop Goals

## Status

1. 日期：`2026-07-07`
2. 性质：Thoth MVP 的 6 个 Codex goal-mode loop 合同
3. 适用范围：`packages/protocol`、`packages/core`、`packages/daemon`、`packages/drivers`、`packages/client`、`packages/app`、`packages/desktop`
4. 上游合同：`.agent-os/designs/thoth-app-runtime-contract.md`、`packages/protocol/src/thoth-runtime-contract.ts`
5. 状态：canonical execution plan；用于把 `agent/dev/mvp` 从设计合同推进到最小可验证 MVP 业务链路

## 1. 拆分原则

MVP 的核心不是 daemon 能不能落盘、gate 或渲染状态，而是通过 runtime skill、prompt engineering、provider session harness 和 eval harness，让 agent 产生更高质量的工作行为。

Thoth 的 daemon、runtime tool bridge、authority store、repair、permission gate 和 UI 渲染仍然重要，但它们是 agent harness 的机械保障层，不是 MVP 目标本身。

执行顺序仍保持工程上的后端/前端交替：

1. 后端 loop 做 agent behavior contract、runtime skill、provider harness、runtime tool bridge、eval harness 和 daemon authority 兜底。
2. 前端 loop 做对应 agent 行为的低心智负担产品体验。
3. 每个 loop goal 都必须能独立交给 Codex goal mode 执行。
4. 每个 loop goal 都必须有自己的目标、约束和验收。
5. 每个 loop goal 完成时必须更新 `.agent-os` 证据账本，不能只提交代码。

固定顺序：

1. `NTH-MS-012` / `NTH-TD-015`: 后端，Clarify Agent Harness + Convergence Contract。
2. `NTH-MS-013` / `NTH-TD-016`: 前端，App Refactor Foundation + Workspace Secretary Clarify Experience。
3. `NTH-MS-014` / `NTH-TD-017`: 后端，Task Contract Compiler + Approval Harness。
4. `NTH-MS-015` / `NTH-TD-018`: 前端，Task / Pyramid Plan Approval Experience。
5. `NTH-MS-016` / `NTH-TD-019`: 后端，Loop Execution + Review Agent Harness。
6. `NTH-MS-017` / `NTH-TD-020`: 前端，Background Task Dogfood Experience。

## 2. 全局约束

这些约束适用于全部 6 个 loop goals：

1. Thoth 是任务控制平面，不是 harness 工具，不是隐藏 LLM API wrapper。
2. 所有 AI/agent 能力来自配置的 provider session；Thoth 本身不私自调用通用 LLM API。
3. Thoth daemon 不做自然语言智能；它只做 runtime context、tool/card schema 校验、状态转移、repair、两次确认 gate、permission gate、落盘和 client broadcast。
4. `thoth.clarify` 和 `thoth.loop` 是内置、隐藏、非可选、跨 provider 兼容 runtime skills，
   以标准 `SKILL.md` artifact 作为 canonical source。
5. 用户面对的是 Thoth 任务控制平面；PlanExec、Review、provider roles、skills、packet、state code 都是内部机制。
6. APP MVP 的前端 substrate 必须回到原版 Paseo app surface，保留其 session/workspace/task/detail、stream、composer、settings、host/provider、attachments、file links、terminal/browser/file panes、responsive layout 和 e2e/test 能力。
7. Loop-2 允许最小 Background Tasks 浏览入口展示 `registered_pending`，但不得伪装 PlanExec / Review；最终 dogfood task 系统属于后续 loop goal。
8. `New Agent` / session / workspace 等原版 Paseo surface 能力可以保留为交互 substrate，但用户可见心智必须被映射为 Thoth task loop / Clarify runtime control，而不是原样保留 Paseo agent manager。
9. 后台 Loop 注册必须经过两次用户确认：Task Card 和 Pyramid Plan Card。wire code 可继续使用
   `C_GOAL_CARD` 兼容旧协议名，但用户可见语义是 Pyramid Plan Card。
10. Task Card 是 compact CEO overview，只含 `title`、`goal`、`constraints`、`acceptance`；
    Pyramid Plan Card 是目标金字塔，表达 target / stages / subgoals / acceptance evidence，不写
    risk、why_loop、implementation plan、文件路径、命令或代码级执行步骤。
11. 不恢复归档 Python/plugin runtime、归档 dashboard template、归档 Textual TUI、voice/audio/speech/dictation。
12. 不触碰、复用、停止或 fallback 到 Paseo/legacy daemon `127.0.0.1:6767`。
13. Relay pairing token、raw offer、credential、subprotocol token 不得出现在 URL query、日志、截图、docs 示例或 final 报告。
14. 每个 loop goal 至少运行本次改动相关 root/package gate；基础门禁保持 `npm run check:foundation`。
15. `thoth.clarify` 和 `thoth.loop` 的开发必须是 golden-driven，不允许只靠 packet/schema 或工具 schema 测试判断 skill 合格。
16. 每次修改 runtime skill、prompt contract、rubric 或关键行为约束，都必须在固定 golden 数据上复跑，并保留当前输出与审查结论。
17. 主开发 Codex session 不能自评 skill 行为质量；必须使用独立 session，通常通过 `codex exec`，按 rubric 审查 golden transcripts。
18. 独立 judge 的核心审查维度是：行为心理学问题质量、行为树收敛、目标/约束/验收符合度、是否减少用户心智负担。
19. 如果独立 judge 判定 agent 问了无关紧要的问题、把可自行发现的事实推给用户、没有推进收敛、重复追问、忽略 frozen contract、浪费用户注意力或 retry 机械重复失败策略，则该 loop 不能验收，必须修改 skill/prompt/rubric 后重跑 golden review。
20. Thoth internal runtime skills 不得写入用户全局 provider skill 目录，例如 `~/.codex/skills`、
    `~/.claude/skills` 或 `~/.agents/skills`；它们只能在 Thoth-owned provider session scope 内
    原生加载或隔离文件系统发现；不允许把完整 `SKILL.md` 粘进每轮 prompt 作为 fallback。
21. 普通同状态 provider runtime context 不重复 `SKILL.md` 规则；session start、状态转移、skill
    digest/version 变化、context 丢失或 repair 多次失败时才带 `skill_ref` / digest marker。
22. 前端体验必须是 provider-backed streaming-first：Quick 回复、provider reasoning、shell/edit/read/
    write/search/fetch/tool/progress/evidence 事件通过 AgentTimeline 渐进渲染；Clarify Card、Task
    Card 和 Pyramid Plan Card 由 daemon 验证完整 runtime tool submission 后作为 typed authority card
    一次性渲染。
23. `Quick + none` 是裸 provider / Paseo-like 前台路径，不加载 `thoth.clarify`，不包 Clarify
    envelope，不注册 Thoth semantic runtime tools，不要求结构化 Clarify output，不进入 Clarify repair。
24. `Quick + clarify` 使用 `turn_phase` 区分 `clarify`、`approval_task`、
    `approval_breakdown`、`quick_exec` 和 `repair`；除 `quick_exec` 外，structured phase 必须通过
    provider runtime tool bridge 调用语义化 Thoth tools，例如 `thoth_submit_clarify_card`、
    `thoth_submit_task_card`、`thoth_submit_pyramid_plan` 或 `thoth_report_blocked`。
25. Loop-2 中 `Loop` 的 secretary session 只负责 Clarify 和两张确认卡；确认后 daemon 注册
    `registered_pending`，不启动 PlanExec / Review。后台执行由 `NTH-TD-019` 实现。

## 3. Loop Goal 1: Backend Clarify Agent Harness + Convergence Contract

Milestone：`NTH-MS-012`
TODO：`NTH-TD-015`
顺序：第 1 个，后端。

目标：

设计并实现 `thoth.clarify` 的第一版 agent harness，使 provider-backed secretary session 能通过多轮 Clarify 在用户 prompt 的行为树上切出最高价值分叉、避免低价值追问和目标降级、区分 agent 可自行发现的信息与必须由用户判断的信息，并能判断当前意图是否已经收敛到可以 Quick 裸直答、active Clarify 直答、继续 Clarify、生成 Overview / Task Card、生成 Pyramid Plan Card 或进入 blocked。

这个 loop 的核心是：让秘书 agent 会澄清，会判断收敛。

约束：

1. Clarify 不是 `request_user_input`，不是 `AskUserQuestion`，不是缺字段问卷。
2. Clarify 必须是行为心理学驱动的秘书式收敛过程。
3. 本地 deterministic code 不做语义判断；语义判断必须发生在 provider-backed secretary session 中。
4. agent 可以自行检查的事实，不能推给用户。
5. 行为树是对用户 prompt 的拆解树；每轮 Clarify 应选择当前最能排除错误路线和分歧的分叉点。
6. 必须问用户的，只能是会改变目标路线、风险、资源边界、偏好、验收标准、不可逆选择的问题。
7. 每轮默认只问一个最高杠杆分叉问题，除非多个分叉强相关且会减少来回成本。
8. 问题必须保留用户原始目标；允许询问目标等级、路线、验收、风险或优先级，但禁止把用户目标降级成更容易的 MVP、demo、mock、局部实现或另一个目标。
9. Clarify 默认不提供默认值或推荐选项。技术性强且 agent 更适合判断的问题应由 agent 自己判断并记录假设；只有用户要求推荐时才给推荐。
10. 问题必须降低用户心智负担：给足上下文、切出清楚分叉、避免兜底降级问题、避免泛泛收集需求。
11. 用户输入 `hi` 等问候时，`Quick + none` 必须走裸 provider stream，不加载 Clarify、不输出 packet、不出卡；`Quick + clarify` / Loop Clarify phase 可以由真实 provider session 产出 active Clarify direct response。两种路径都必须回复得像秘书一样简短自然，不解释产品机制，不展示 Clarify UI，不允许 daemon 本地固定问候。
12. `thoth.clarify` 必须由标准 skill-create / skill creator 流程制作成 Thoth internal
    `runtime-skills/thoth-clarify/SKILL.md` artifact；`SKILL.md` 是 canonical source，不使用
    Codex-only 格式，不依赖 Codex-only metadata。
13. `clarify_strength` 必须落成可验证行为：`none` 表示不进入 `thoth.clarify`，直接走裸 provider
    foreground stream；`light` 只问最高影响核心分叉；`balanced` 深入 1-2 层 material leaves；
    `dive` 尽量消除 material assumptions 但仍不问细枝末节、常识、standard answer 或可发现事实。
14. Clarify 必须区分 assumption owner：`user_must_decide`、`agent_can_decide`、
    `agent_can_discover`、`standard_answer/common_sense`；只有高影响 `user_must_decide` 能问用户。
15. Clarify Card 的 runtime tool/card schema 必须能表达一个标题和 2-4 道紧密相关的行为树问题；
    每道题有短分支选择，每个选择 label 不超过 15 个字，每个解释不超过 30 个字。
16. `C_ASK` 可携带 internal `content.meta`，记录 `effective_clarify_strength`、tree depth、QA
    round count、remaining material assumptions 和 question value reason；这些 meta 不给用户直接看。
17. 用户答复 card 必须支持：对每道题的选择项附加 note；也可以不选任何项，只写 note。
18. tool schema、packet 和状态码只是机械约束，不是产品目标。
19. daemon 只做 schema、状态码和 repair 机械兜底，不负责决定该问什么。
20. Clarify 结束进入 Task Card 时，Thoth 必须在 runtime tool submission / authority event 中机械化附带此前所有 Clarify 问答的原文 transcript。
21. Clarify 进入 Pyramid Plan Card 时，Thoth 必须在 runtime tool submission / authority event 中同时附带此前所有 Clarify 问答的原文 transcript，以及第一轮用户确认过的总 CEO Task Card 原文。
22. Pyramid Plan 分拆必须以原文 Clarify transcript 和已确认 CEO Task Card 为 authority；不能依赖 provider 隐式记忆，不能臆造、丢失、篡改或过度解释用户已确认的目标、约束和验收。
23. `Quick + none` 不得挂载 `thoth.clarify`、不得构造 Clarify input envelope、不得注册 Thoth
    semantic runtime tools、不得要求 structured Clarify output、不得把 provider 普通输出强制修成
    authority card。
24. `Quick + clarify` 必须显式使用 `turn_phase`：`clarify`、`approval_task`、
    `approval_breakdown`、`quick_exec`、`repair`。
25. `clarify` / `approval_task` / `approval_breakdown` / `repair` phases 必须通过 provider runtime
    tool bridge 调用语义化 Thoth tools；`quick_exec` phase 在同一 secretary session 中流式执行，不提交
    Clarify authority card，除非遇到新的高影响用户决策点并回到 `clarify`。
26. Loop-2 中，`Loop` 模式下 secretary session 只完成 Clarify 与两张确认卡；确认后 daemon 注册
    `registered_pending`，不能在 secretary session 里偷跑 PlanExec / Review。
27. `submit_runtime_packet` / `submit_clarify_packet` 是旧泛称或 legacy bridge；当前主语义工具是
    `thoth_submit_clarify_card`、`thoth_submit_task_card`、`thoth_submit_pyramid_plan` 和
    `thoth_report_blocked`。
28. Tool/skill 能力通过 provider session config、Codex `dynamicTools`、MCP tools list、
    ACP/harness control surface 或 scoped runtime bridge 注入，不在每轮用户 prompt 里复制完整 tool
    schema 或 `SKILL.md` 规则。
29. 普通同状态轮次 runtime context 只传运行态数据，不重复 Skill 规则，不带 `skill_ref`；运行态数据包括
    controls / `clarify_strength` / `effective_clarify_strength`、transcript ref、assumption ledger ref
    和 decision-tree frontier ref。
30. 状态转移轮次带 `skill_ref` / digest / `according_to_loaded_skill`，但不复制 transition rules；
    Clarify 强度变化时带 `controls_changed`。
31. Repair 只修 tool input shape / state / provenance，不重新解释用户意图，不修改 transcript、目标或
    已确认 CEO Task Card。
32. `thoth.clarify` / `thoth.loop` 不得安装到用户全局 provider skill dirs；只在 Thoth-owned
    provider session scope 内可见。

验收：

1. 有 `thoth.clarify` skill/prompt contract，明确每个 Clarify 状态码下 agent 的行为。
2. 有 convergence rubric，定义什么时候继续问、什么时候停止问、什么时候 Quick 直答、什么时候生成 Task Card、什么时候 blocked。
3. 有行为心理学问题原则：最高杠杆行为树分叉、保留用户原目标、禁止兜底降级、默认不提供推荐、避免问可发现事实、避免开放式大问题、避免重复追问。
4. 有 eval harness，可以用 deterministic fixture provider 或 transcript fixture 模拟多轮 Clarify。
5. 有 Clarify golden 数据集，记录每个场景的用户输入、上下文、期望行为树分叉节点、可接受输出范围、禁止问题类型和低心智负担判断。
6. 场景 eval 覆盖用户说 `hi`：`Quick + none` 必须走裸 provider stream，不加载 Clarify、不提交 packet、不出 card；`Quick + clarify` 可走 active Clarify direct response，不澄清，不出 card。两者都必须回复简短自然且不得是 daemon 固定文案。
7. 场景 eval 覆盖用户说“帮我把这个项目做好”：先问最高杠杆行为树分叉，而不是字段问卷。
8. 场景 eval 覆盖模糊但低风险小任务：不要过度澄清。
9. 场景 eval 覆盖想注册后台任务但验收标准不清楚：围绕验收问。
10. 场景 eval 覆盖缺少风险/权限/资源边界：问边界而不是技术实现。
11. 场景 eval 覆盖用户回答后仍模糊：第二轮问题必须推进，不重复。
12. 场景 eval 覆盖信息已经足够：停止 Clarify，输出 task candidate。
13. 场景 eval 覆盖用户说“你决定”或要求推荐：agent 才给建议；若技术判断 agent 更适合决定，则 agent 自行决定并记录假设，而不是反复推回用户。
14. 场景 eval 覆盖高风险需求：agent 要求明确确认或 permission。
15. 场景 eval 覆盖互相矛盾需求：agent 指出冲突并问一个决策问题。
16. 场景 eval 覆盖目标降级式兜底：例如用户要求实现 A，agent 不得问是否改做更容易的 B、MVP、mock、demo 或局部替代物。
17. 场景 eval 覆盖 standard Skill artifact：`SKILL.md` 有 YAML frontmatter、`name`、
    `description`、Markdown body、state codes、transition rules、question rules、good/bad cases 和
    output contract，且不是 Codex-only 格式。
18. 场景 eval 覆盖 Clarify answer/card：卡片有标题、2-4 道紧密相关问题，每道题有短分支选择，
    每个 label 不超过 15 个字、每个解释不超过 30 个字、每个选择可带 note、也可不选只写 note。
19. 场景 eval 覆盖同一个 Three.js PathTracing prompt 在 `none` / `light` / `balanced` / `dive`
    下产生不同行为：`none` 走裸 provider foreground stream；`light` 只问最高影响核心分叉；
    `balanced` 深入 1-2 层 material leaves；`dive` 继续消除 material assumptions，并证明强度不是
    只写在字段里。
20. 场景 eval 覆盖 assumption owner：`agent_can_decide`、`agent_can_discover` 和
    `standard_answer/common_sense` 不能被当成用户问题推回去。
21. 场景 eval 覆盖 `C_ASK` internal meta：effective strength、tree depth、QA round count、
    remaining material assumptions 和 question value reason。
22. 独立 `codex exec` judge 审查 golden transcripts，判断问题是否符合行为心理学、是否推动行为树收敛、是否保留用户原目标、是否满足目标/约束/验收、是否避免浪费用户心智。
23. judge 审查必须明确指出任何目标降级式兜底、低价值追问、字段问卷化、重复追问、把 agent 可发现事实推给用户、未请求却给默认推荐或没有推进收敛的问题。
24. Golden eval 覆盖多轮 Clarify 后进入 Task Card：runtime tool submission / authority event 必须包含完整 Clarify 问答原文 transcript，Task Card 内容必须可追溯到 transcript。
25. Golden eval 覆盖 Task Card 用户确认后进入 Pyramid Plan Card：runtime tool submission / authority event 必须同时包含完整 Clarify 问答原文 transcript 和用户确认过的总 CEO Task Card 原文；第二张卡必须拆成目标层次而非重复 Task Card 或写 implementation steps。
26. 独立 judge 必须审查 Task Card / Pyramid Plan Card 是否丢失、篡改、臆造、过度解释或偏离 Clarify transcript 与已确认 CEO Task Card。
27. Golden eval 覆盖 no-global-install、session-scoped-skill-visible、bare-provider-skill-invisible、
    normal-turn-does-not-repeat-skill-rules、transition-turn-carries-skill-reference 和
    repair-tool-input-shape-only。
28. Golden eval 覆盖 semantic runtime tool bridge：structured phases 必须调用且只调用一个合适的
    Thoth semantic tool；`quick_exec` 不要求 Thoth authority tool call；`submit_runtime_packet` /
    `submit_clarify_packet` 不再作为 Clarify 主合同。
29. Golden eval 覆盖 prompt hygiene：tool schema / `SKILL.md` 规则不复制进每轮用户 prompt；per-turn
    input 只含 phase、state、controls、user input、transcript/provenance refs 和短 expectation。
30. Golden eval 覆盖 Quick 收尾：Task Card 和 Pyramid Plan Card 确认后，Mode=Quick 进入同一个
    secretary session 的 `quick_exec` 流式执行，不注册后台 task；Mode=Loop 在 Loop-2 中注册
    `registered_pending`，不启动 PlanExec / Review。
31. 独立 `codex exec` judge 必须审查 `SKILL.md`、invocation context、transition context、repair
    instruction 和 golden outputs。
32. 独立 `codex exec` 用户交互模拟必须基于安装后的 Thoth runtime artifact，模拟 `hi`、模糊大任务、
    Three.js PathTracing、分支回答、note-only 回答、`你决定`、`够了/不要再问`、验收不清、风险/删除边界、
    矛盾需求、Task Card 确认和 Pyramid Plan Card 确认，并明确 PASS/FAIL。
33. 最终验收标准：agent 问的问题像秘书，不像表单；能减少用户负担，并能被独立 judge 判定稳定收敛；
    Quick+none 保持裸 provider 体验；Quick+clarify 能在 Clarify / approval / quick_exec phases 间
    稳定切换；最终两轮确认卡有完整 provenance；internal runtime skill 不污染裸 provider 环境；
    普通 runtime context 不重复 Skill 规则。

## 4. Loop Goal 2: Frontend App Refactor Foundation + Workspace Secretary Clarify Experience

Milestone：`NTH-MS-013`
TODO：`NTH-TD-016`
顺序：第 2 个，前端。

目标：

回到原版 Paseo 的生产级 React Native / Expo / web / desktop app surface，把它作为 Thoth Loop-2 的主 frontend substrate；删除、回退或隔离当前自己写的 Thoth toy shell 主入口，只把 Thoth Clarify runtime、phase-aware context、Codex `dynamicTools` semantic runtime tool bridge、composer controls、pending decision authority 和 AgentTimeline authority cards 接入原版 Paseo 的 stream / session / workspace / task/detail 体系。

这个 loop 的核心不是“反 Paseo”，而是停止用 toy shell 伪装产品。Paseo 的成熟 UI 能力必须保留；Thoth 的任务控制平面心智必须通过 Clarify / runtime tool bridge / pending authority / AgentTimeline 接进去，不能把 Paseo agent manager 心智原样保留，也不能为了改名丢掉生产级 stream、composer、attachments、settings、panes 和 responsive layout。

1. 恢复 / 保持原版 Paseo frontend app 能力和布局为主入口。
2. 保留 agent-stream、bottom anchor、turn boundary、virtualization、native-web render strategy、原版 composer、attachments、file drop、file links、markdown/code/diff/highlighted content、adaptive modal sheet、card/sheet primitives、settings、host picker、provider settings、relay pairing、diagnostics、workspace/session list/detail layout、terminal/browser/file panes、keyboard/focus/accessibility、desktop/mobile responsive layout 和现有 e2e/test harness。
3. 删除、回退或隔离 `packages/app/src/thoth-app/thoth-app-shell.tsx` 及 toy shell route/e2e/snapshot 等主路径依赖。
4. 在原版 Paseo composer 上映射三个控件：`Models` -> `Provider`，`Think` -> `Clarify`，`Feature` -> `Mode`。
5. `Provider` 写入 daemon Settings 的 `workspaceSecretary.providerSession` 或等价 provider-session 配置；mock/dev provider 不能用于验收。
6. `Clarify` 映射 `clarify_strength`，至少支持 `none/direct`、`light`、`balanced`、`dive`，可保留 `auto`。
7. `Mode` 映射 `Quick` / `Loop`；Quick 是前台对话，不注册后台任务；Loop 进入 Clarify 收敛和后续任务合同路径。
8. Clarify card 稳定渲染在 Paseo 原始 transcript / agent-stream 中，不作为单独页面或 toy shell 卡片。
9. Loop/task/background 状态本轮以 Paseo 原始 session/workspace/task/detail view 系统为主；允许一个最小 Background Tasks 浏览入口展示 `registered_pending` 列表和详情，但不得伪装 PlanExec / Review。
10. Settings 保留 Paseo 原版能力，并接入 provider/session、clarify runtime status、relay status、workspace/session diagnostics 和 required internal skills status；真实 relay 验收绑定 `relay.test.thoth.seeles.ai`。
11. 真实 provider AgentTimeline 是用户可见体验：`Quick + none` 的裸 provider 文本、thinking/progress/tool/evidence 事件流式进入 AgentTimeline；Clarify / Task / Pyramid 卡片必须来自 validated semantic runtime tool submission，完整校验后 atomic 渲染。
12. `Quick + clarify` 的 UI journey 必须支持 `clarify -> approval_task -> approval_breakdown -> quick_exec`，其中 `quick_exec` 在同一 session 中前台流式执行，不显示后台注册结果。

约束：

1. 不新写平行 Thoth app shell；当前 toy shell 不能继续作为主入口。
2. 不把 `WORKSPACE SECRETARY`、`当前需求收敛`、`Quick 前台 · Loop 后台`、`真实 provider 已连接`、`Quick 和 Loop 都会通过真实 provider 结果写入历史`、`当前秘书话题`、`新秘书话题`、完整 `/mnt/cfs/...` 路径、`provider-backed clean UI model`、`C_DIRECT` / `C_ASK`、packet、repair、schema、raw JSON、provider role 等内部机制作为生产主界面文案。
3. 这些内部信息可以进入 Settings diagnostics、tooltip 或测试断言，但不能作为主视觉和普通用户路径。
4. 前端不得展示 `thoth.clarify`、`SKILL.md`、packet、state code、repair、provider role、PlanExec、Review、raw JSON、schema error 或 runtime skill invocation。
5. 前端不得本地判断是否继续 Clarify、是否收敛、是否进入 Task Card 或 blocked；不得从 assistant 文本、markdown JSON、code fence、snippet 或 raw packet 猜 UI 状态，只能消费 daemon/client/protocol 给出的 AgentTimeline items 和 typed authority card models。
6. 前端不得本地生成 semantic card、Task Card、Pyramid Plan Card，不得替用户选择默认项，不得 first-option fallback。
7. 前端不得把 `Quick + none` 的普通 provider stream 包装成 Clarify card，也不得在 `Quick + none` 下显示 skill、packet、repair 或 structured-output 失败。
8. 如果协议 view model 尚不完整，只能使用明确命名的 development fixture adapter；fixture/mock/dev path 不得冒充 production authority，不得伪造 relay connected 状态；Quick / Clarify / Loop 验收不得使用 offline fixture、mock success 或 deterministic daemon reply/card 代替真实 provider。
9. Clarify card 必须是 Thoth decision card，不是 `request_user_input`、`AskUserQuestion`、permission question 或命令行 prompt 的换皮；但应复用 Paseo 现有 card/request-user-input 渲染能力。
10. Clarify card 支持标题、why-now、2-4 道紧密相关问题、每题 2-4 个短选项、每选项短解释、per-option note、note-only、你推荐、你决定；submitted 后 readonly；多轮不覆盖历史。
11. 默认不得预选、不得默认推荐、不得用视觉权重诱导用户一路点默认；只有用户主动点“你推荐”或“你决定”时才提交结构化 intent。
12. 移动端和桌面端同等验收；Clarify card 不能遮挡 composer、压迫聊天流、导致键盘遮挡、按钮溢出或不可恢复滚动。
13. 不允许新增或保留 voice/audio/dictation 可见能力；不允许复用、探测、fallback 到 Paseo/legacy daemon `127.0.0.1:6767`；不允许用 `#`、`example.com`、localhost relay、假 device link 或 mock success 冒充真实 relay。
14. `.agent-os/upstreams/paseo` 只能作 ignored reference，不得 stage/commit 或成为 runtime dependency。
15. "不兜底" 指功能不兜底：没有真实 provider、真实 relay、合格 semantic runtime tool bridge 时，UI 必须显示 honest unavailable / blocked / needs provider / unsupported / needs relay 状态并阻断动作，不能用本地固定回复、mock success、offline fixture、provider waterfall、first-option fallback、assistant markdown JSON 抽取、文本解析、假 provider、假 card 或假 relay 冒充完成。
16. 普通 assistant response 作为 AgentTimeline 渐进渲染；Clarify Card、Task Card 和 Pyramid Plan Card 必须聚合完整 runtime tool input，完成 daemon schema/provenance/authority 校验后再追加为完整 card，不能出现半张卡、半个选项、半个审批按钮。

验收：

1. anti-toy-shell / anti-internal-copy residual scan 通过：生产主界面无 toy shell 文案、验收文案、完整本地路径、packet/schema/raw JSON/provider-role/state-code/repair 机制泄漏；最小 Background Tasks 入口只能展示 `registered_pending`，不能成为 fake PlanExec / Review toy 主视图。
2. Paseo capability retention scan/source review 通过：主路径仍使用 agent-stream、bottom anchor、turn boundary、virtualization/native-web render strategy、原版 composer、attachments/file drop/file links、markdown/code/diff/highlighted content、adaptive sheets/cards、settings、host/provider、relay pairing、diagnostics、workspace/session list/detail layout、terminal/browser/file panes、responsive layout 和 e2e/test harness。
3. composer 控件通过：Provider / Clarify / Mode 三个控件出现在原版 composer 控制区；Provider 写入真实 provider/session 配置；Clarify 映射 strength；Mode 映射 Quick/Loop；附件、slash command、draft、keyboard、send、focus、mobile behavior 不退化。
4. Clarify card 通过：卡片稳定渲染在 Paseo transcript / agent-stream 中，支持标题、why-now、2-4 道紧密问题、每题 2-4 个短选项、短解释、per-option note、note-only、你推荐、你决定、submitted readonly 和多轮不覆盖历史。
5. authority boundary 通过：源码审查证明 app 只渲染 AgentTimeline items 和 typed authority card models，不解析 assistant 文本、markdown JSON、code fence、snippet 或 raw packet，不本地判断收敛，不生成 Task/Pyramid Card，不替用户选择。
6. stream/render review 通过：真实 provider-backed `Quick + none` 裸文本、thinking/progress/tool/evidence 能渐进显示；Clarify / Task / Pyramid card 只在 validated semantic runtime tool submission 和 daemon validation 后 atomic 出现。
7. 测试通过：Clarify card component/unit tests、`npm --workspace=@thoth/app run test`、Loop-2 narrow real-provider e2e、`npm run build:web`、真实 `relay.test.thoth.seeles.ai` 验收和 `npm run check:foundation` 均实际运行并记录。
8. 真实旅程通过：`Quick + none` 的 `hi` 是裸 provider stream 且无 Clarify card/packet/repair；`Quick + clarify` 能 Clarify -> Task Card -> Pyramid Plan Card -> same-session `quick_exec`；Quick -> Loop -> Clarify -> 两卡确认 -> `registered_pending` 稳定；未配置真实 provider/relay/bridge 时动作诚实阻断而非 fake success。
9. 视觉证据齐全：保存 desktop screenshot、mobile screenshot、原版 Paseo app layout 保留截图、composer Provider/Clarify/Mode 截图、streaming Quick 截图或 trace、`hi` 无 card 截图、完整 atomic Clarify card 截图、submitted readonly card 截图、Task/Pyramid card、quick_exec Shell/Edit timeline、registered_pending、Settings 真实 relay 状态截图和 Playwright trace/video。
10. 截图必须用 `view_image` 实际打开审查，不得只证明文件存在。
11. 独立 UI mental-model review 通过：独立 `codex exec` 只看截图、trace、关键代码摘要和验收清单；若发现 toy shell、Paseo 能力破坏、composer 退化、Clarify card 不稳定、Quick+none 被协议化、`quick_exec` 不像普通 provider 执行、authority cards 非 atomic、app 解析 raw packet/markdown JSON、fake provider/relay/mock success、用户可见 debug/验收文案或 fake Background Tasks running/review，则 FAIL。
12. `.agent-os` 记账完成：更新 change-decisions、loop goals、goal prompt、architecture milestones、todo、project-index、acceptance-report、run-log，必要时 lessons-learned；缺任何关键证据时 `NTH-TD-016` 保持 doing 或 blocked，不得 verified。

当前结果：

`NTH-TD-016` / `NTH-MS-013` 已由 `NTH-EV-029` 验证通过。`NTH-EV-026` 和 `NTH-EV-028` 是历史证据：
它们证明过三视图 toy Workspace Secretary shell、provider-backed streaming 和 atomic Clarify QA card
的一部分机制，但不再作为当前 Loop-2 authority。当前通过证据证明 restored Paseo app surface 是主路径，
Paseo 生产级能力未退化，toy shell 不再是用户入口；`Quick + none` 是裸 Codex/Paseo stream；
`Quick + Dive` 通过 Codex app-server `dynamicTools` / `item/tool/call` 调用 semantic Thoth runtime
tools；Clarify/Task/Pyramid cards 通过 pending authority decisions 渲染进 AgentTimeline；
Quick same-session `quick_exec` 显示真实 Shell/Edit timeline；Loop 确认后只注册 durable
`registered_pending`，不伪造 PlanExec / Review。

## 5. Loop Goal 3: Backend Task Contract Compiler + Approval Harness

Milestone：`NTH-MS-014`
TODO：`NTH-TD-017`
顺序：第 3 个，后端。

目标：

实现 `thoth.clarify` 从已收敛意图到可审批任务合同的 agent harness。让 secretary agent 能把多轮 Clarify 的结果编译成两层合同：CEO 级 Task Card 和 Pyramid Plan Card。

这个 loop 的核心是：让 agent 会写合同，而不是写计划。

约束：

1. Task Card 不能是实现计划，必须是整体审批材料。
2. Pyramid Plan Card 不能是 step-by-step execution plan，只能是 target / stages / subgoals / acceptance evidence 的目标金字塔。
3. Task Card 只允许 `title`、`goal`、`constraints`、`acceptance`。
4. agent 必须能判断什么时候不该注册 Loop，而应该保持 Quick。
5. agent 必须能把用户模糊表达转成清晰验收标准，但不能捏造用户没有授权的目标。
6. 如果验收标准还不够，必须回到 Clarify，而不是强行出合同。
7. daemon 的两次确认 gate 是机械保证，但合同质量来自 agent harness。
8. 合同必须 CEO 可读，短、准、可审批。

验收：

1. 有 Task Contract Compiler prompt/rubric。
2. 有 Task Card rubric，只覆盖 `title`、`goal`、`constraints`、`acceptance`，明确禁止 `risk`、`why_loop` 和 implementation plan。
3. 有 Pyramid Plan Card rubric，保证 target / stages / subgoals / acceptance evidence 层次化、可追溯、非实现计划。
4. eval 覆盖已收敛小任务：agent 建议 Quick，不注册 Loop。
5. eval 覆盖已收敛后台任务：agent 输出 Task Card。
6. eval 覆盖验收不清楚：agent 回到 Clarify。
7. eval 覆盖用户目标很大：agent 拆成少量层次化 stages / subgoals。
8. eval 覆盖 agent 不把 implementation plan 写进 Pyramid Plan Card。
9. eval 覆盖 agent 不把自己可以决定的执行细节推给用户。
10. eval 覆盖用户修改 Task Card 后 agent 能更新合同。
11. eval 覆盖用户修改 Pyramid Plan Card 后 agent 能保持约束一致。
12. eval 覆盖高风险任务必须用 constraints / acceptance 表达边界，不新增 risk 字段。
13. 合同内容必须能被 daemon runtime tool/card schema 校验。
14. 最终验收标准：agent 能把 Clarify 结果编译成用户愿意审批、后续 agent 可执行、review 可验收的任务合同。

## 6. Loop Goal 4: Frontend Task / Pyramid Plan Approval Experience

Milestone：`NTH-MS-015`
TODO：`NTH-TD-018`
顺序：第 4 个，前端。

目标：

把 Loop 3 的合同编译能力变成用户可审批体验。用户不应该看到系统生成了 JSON，而应该看到秘书递上来两张清楚、轻量、可修改的审批卡：Task Card 和 Pyramid Plan Card。

这个 loop 的核心是：让用户像 CEO 审批秘书整理好的任务，而不是像工程师检查 schema。

约束：

1. Task Card 要 compact，不能变成 PRD 或计划书。
2. Pyramid Plan Card 要用目标金字塔表达 target / stages / subgoals / acceptance evidence，不能列 execution steps、文件路径或命令。
3. 用户必须能修改、确认、取消、保持 Quick。
4. 两次确认都必须是清楚的用户动作。
5. UI 不能显示 packet、state code、skill。
6. 如果用户修改合同，必须回到 agent harness 重新整理，而不是前端本地改 authority。
7. 确认后仍然回到 Workspace Secretary，不能把用户丢到后台日志页。
8. 同一个 secretary session 可以继续 Quick，也可以以后再注册另一个 Loop。

验收：

1. Workspace Secretary 能显示 Task Card。
2. Task Card 支持注册为后台任务、保持 Quick、修改、取消。
3. 用户修改 Task Card 后，agent 能重新生成更好的 Task Card。
4. 第一次确认后显示 Pyramid Plan Card。
5. Pyramid Plan Card 显示目标层次、阶段、子目标和验收证据，不重复 Task Card 全文，不显示 risk。
6. Pyramid Plan Card 支持确认注册、修改、取消。
7. 用户确认 Pyramid Plan Card 后显示 Registered Card 和 Background Task 链接。
8. 注册后 composer 回到 Quick，用户可继续聊天。
9. e2e 覆盖 Task Card 修改、取消、确认；Pyramid Plan Card 修改、取消、确认；注册后回 Quick。
10. 验收重点是用户能低负担审批，而不是被迫理解后端状态机。

## 7. Loop Goal 5: Backend Loop Execution + Review Agent Harness

Milestone：`NTH-MS-016`
TODO：`NTH-TD-019`
顺序：第 5 个，后端。

目标：

实现 `thoth.loop` 的 agent harness，让后台 PlanExec 和 Review provider sessions 能基于 frozen contract 执行、请求权限、产出证据、自我推进、接受独立 review，并在失败时形成 non-repeating retry guidance。

这个 loop 的核心是：让后台 agent 会执行和自审，而不是 daemon 会跑任务队列。

约束：

1. PlanExec 只能推进当前 goal，不能跳 goal。
2. PlanExec 可以自行调查、执行、验证，但高风险动作必须 permission。
3. PlanExec 不能反复把 Clarify 后已经冻结的问题再推给用户。
4. 如果 provider 问执行细节，Thoth 应从 frozen contract 或推荐默认值回答，并记录。
5. Review session 必须独立，且不能修改 workspace。
6. Review 不是跑测试的同义词，它要判断 evidence 是否满足 acceptance。
7. Review 失败必须给出失败原因、下一轮改变、禁止重复事项。
8. Loop retry 不是机械重跑；必须针对上轮失败调整策略。
9. `Goal x/y` 和 `Round a/b` 是为了约束 agent 行为，不是 UI 装饰。
10. daemon 负责 session orchestration、packet repair、permission gate、stream/evidence 落盘和恢复。

验收：

1. 有 `thoth.loop` skill/prompt contract。
2. 有 PlanExec behavior rubric。
3. 有 Review behavior rubric。
4. 有 retry/non-repetition rubric。
5. 有 Loop golden 数据集，记录单 goal、多 goal、permission、review、retry、blocked、done 等场景的 frozen contract、期望行为、禁止策略和证据要求。
6. deterministic or fixture harness 覆盖单 goal 成功执行。
7. harness 覆盖多 goal 只推进当前 goal。
8. harness 覆盖 PlanExec 遇到权限动作时停下并请求 permission。
9. harness 覆盖 PlanExec 遇到缺省执行细节时使用 frozen contract 或推荐默认值，不反复问用户。
10. harness 覆盖 Review pass 时输出 evidence-based verdict。
11. harness 覆盖 Review fail 时输出 failure reason 和下一轮改变。
12. harness 覆盖 retry round 不重复上轮失败策略。
13. harness 覆盖 Review session 无法修改 workspace。
14. harness 覆盖 task blocked 时给出用户可理解 blocker。
15. harness 覆盖 task done 时给出 evidence summary。
16. 独立 `codex exec` judge 审查 golden Loop transcripts，判断 PlanExec 是否遵守 frozen contract、Review 是否按 acceptance 判 evidence、retry 是否真的改变策略且没有浪费用户心智。
17. judge 审查必须明确指出任何跳 goal、忽略约束、把冻结后的执行细节重新推给用户、证据不足、Review 只等同跑测试、retry 机械重跑或 blocker 不可理解的问题。
18. 最终验收标准：后台 agent 不只是运行命令，而是在 frozen contract 约束下推进、验证、失败后改变策略，并被独立 judge 判定留下可审查证据。

## 8. Loop Goal 6: Frontend Loop/Task Dogfood Mapping

Milestone：`NTH-MS-017`
TODO：`NTH-TD-020`
顺序：第 6 个，前端。

目标：

把 Clarify、Contract、Loop、Review 的 agent harness 产物整合成用户可感知的 MVP 闭环。前端继续以 restored Paseo session/workspace/task/detail view system 为 substrate：Settings 配置能力，session/workspace transcript 承载 Clarify 和合同卡，task/detail surface 展示后台执行、证据、权限、review、retry、完成或 blocked。

这个 loop 的核心是：让用户感觉 Thoth 真的是一个会接任务、会后台推进、会汇报进度的秘书系统。

约束：

1. 不新建独立 Background Tasks toy main view。
2. 默认只显示 CEO 可理解的信息：任务目标、约束、验收、当前 goal、当前 round、是否需要用户处理。
3. provider stream 可以展开，但不能成为主界面。
4. Review verdict 要转成用户能理解的状态。
5. Permission request 要突出风险和决策，而不是技术日志。
6. done 必须有 evidence summary。
7. blocked 必须说明需要用户做什么判断。
8. Web/Desktop 是同一个 APP 体验的不同打包，不做单独 mock 审核页。
9. TUI 不纳入这个 APP MVP loop。
10. 不能泄漏 relay token、raw offer、credential、`6767` fallback。

验收：

1. 端到端 dogfood smoke 覆盖 Settings 显示 provider、daemon、runtime skill 状态。
2. dogfood smoke 覆盖 restored session/workspace transcript 完成 Clarify。
3. dogfood smoke 覆盖用户审批 Task Card。
4. dogfood smoke 覆盖用户审批 Pyramid Plan Card。
5. dogfood smoke 覆盖 restored task/detail surface 出现 registered task。
6. dogfood smoke 覆盖当前 goal 显示 running。
7. dogfood smoke 覆盖 stream 可展开查看。
8. dogfood smoke 覆盖 permission request 能被用户处理。
9. dogfood smoke 覆盖 Review 状态能显示。
10. dogfood smoke 覆盖 failed review 后能显示 retry round。
11. dogfood smoke 覆盖 passed goal 变绿。
12. dogfood smoke 覆盖 task done 显示 evidence summary，或 blocked 显示用户下一步。
13. Web static export 有真实 smoke/screenshot。
14. Desktop dev/review entry 有真实 smoke/screenshot。
15. UI 不暴露 packet、skill、provider role 等内部概念。
16. 最终验收标准：用户能从一个模糊意图开始，经过秘书澄清、合同审批、后台执行、review 汇报，看到一个完整任务闭环。
