# New Thoth MVP User Journey

## Status

1. 日期：`2026-06-29`
2. 性质：全新版本 Thoth 的 MVP 用户视角使用文档
3. 范围：只描述用户在桌面 app、手机 app、TUI、CLI、relay、Claude、Codex、ACP 入口中看到什么、输入什么、点击什么、得到什么结果
4. 边界：不解释架构原因，不写代码、工程接口、目录、数据结构、对象类型、适配层或参考项目文件路径
5. 原始归档：`.agent-os/designs/new-thoth-migration-architecture-20260625.md`

## 1. 第一次打开桌面 app

1. 用户第一次打开桌面 app。
2. 应用展示一个简洁的全局 home。
3. 全局 home 里能看到：
   - 当前本机 Thoth 服务状态
   - 已添加的 workspace 列表
   - 全局 chat 输入框
   - provider 配置状态
   - 待用户处理的卡片数量
4. 如果本机 Thoth 服务没有运行，桌面 app 自动检测并启动。
5. 如果 provider 尚未配置，应用进入 setup wizard。
6. setup wizard 只要求用户完成必要配置，不把 provider 内部差异摊给用户。
7. 完成设置后，用户回到全局 home。

## 2. 添加 workspace

1. 用户点击添加 workspace。
2. 应用打开文件夹选择。
3. 用户选择一个本地项目目录。
4. Thoth 显示确认卡：
   - workspace 名称
   - 本地路径
   - 当前 git 分支
   - 是否存在未提交改动
   - 将用于执行任务的默认策略
5. 用户确认后，该目录出现在 workspace 列表。
6. 如果目录已有未提交改动，Thoth 不阻止添加，但会标记该 workspace 有 dirty state。
7. 添加完成后，用户可以进入该 workspace 页面。

## 3. 桌面 app 的全局 home / global chat

1. 全局 home 是跨 workspace 的入口。
2. 用户可以在 global chat 里和 Thoth 交流。
3. global chat 可用于：
   - 询问总体状态
   - 询问多个 workspace 的进展
   - 记录跨项目想法
   - 直接提问并获得回答
   - 通过显式 `@workspace` 给某个 workspace 派发任务
   - 在 provider-backed 上下文判断高置信时自然对应最近讨论过的 workspace
4. global chat 不要求用户每次都显式 `@workspace`。
5. Thoth 会通过已配置 provider 根据最近对话、活跃项目、用户习惯、workspace 状态和历史任务判断用户可能指的是哪个 workspace。
6. 如果只有一个高置信候选，Thoth 可以自然绑定该 workspace。
7. 如果有多个候选或置信度不足，Thoth 用一张简短卡片让用户选择。
8. 在低置信时，Thoth 不把全局意图擅自写入某个 workspace。

## 4. 显式或自然绑定 workspace

1. 用户可以显式输入：

   ```text
   @my-app 帮我检查登录流程最近的改动有没有破坏移动端体验
   ```

2. Thoth 识别出 `@my-app` 是目标 workspace。
3. Thoth 把这条输入绑定到该 workspace。
4. 用户也可以说：

   ```text
   昨天说的那个登录项目怎么样了？
   ```

5. 如果 provider-backed 上下文判断能高置信对应到唯一 workspace，Thoth 就直接回答或展示该 workspace 的状态。
6. 如果 provider-backed 上下文判断不能确定，Thoth 会问：
   - 你是指 `my-app`，还是 `admin-console`？
7. 绑定 workspace 后，用户在 composer 中选择 `Quick` 或 `Loop`。
8. 如果选择 `Loop`，Thoth 创建任务草稿，并进入澄清与合同冻结流程。
9. 用户在 global chat 中也能继续完成该任务的澄清卡和确认卡。
10. 任务进入执行后，它会出现在对应 workspace 的任务列表中，也会在 global home 聚合显示。

## 5. 不确定 workspace 时的全局对话行为

1. 用户在 global chat 里直接说：

   ```text
   帮我把最近这些想法整理成下一步计划
   ```

2. 如果是否需要绑定 workspace 本身不明确，Thoth 通过 provider-backed 上下文判断来处理。
3. 如果 provider-backed 判断认为它只是全局想法整理，Thoth 直接作为全局讨论处理。
4. 如果 provider-backed 判断认为它需要落到某个 workspace，但没有高置信候选，Thoth 只问一个关键问题：
   - 这个计划要落到哪个 workspace？
5. 在用户明确选择或 Thoth 高置信解析前，不创建 workspace 正式任务。
6. 这样既保留秘书式上下文理解，也避免把全局想法误派到错误项目。

## 6. Workspace 页面

1. 用户点击某个 workspace。
2. 页面展示该 workspace 的工作区视图。
3. 默认区域包括：
   - workspace chat
   - 当前任务队列
   - 正在运行的任务
   - 待确认卡片
   - 最近报告
   - provider 健康状态
4. workspace chat 的输入天然绑定当前 workspace。
5. 用户在 workspace chat 中输入需求时，不需要再 `@workspace`。
6. workspace 页面不展示全局其他项目的细节，除非用户返回全局 home。

## 7. 用户输入自然语言需求

1. 用户可以一口气输入背景、目标、顾虑、限制和期望。
2. 示例：

   ```text
   我想把设置页里的账号安全区域重新整理一下。
   现在入口太散，用户找修改密码和二步验证很麻烦。
   但不要大改整个设置页，最好只动安全相关区域。
   做完后要确认桌面和手机宽度下都不崩。
   ```

3. 用户不需要提前写成固定模板。
4. 用户不需要指定内部角色。
5. 用户不需要选择模型或执行 harness。
6. 用户在输入框附近看到五个 composer 控件：
   - `+`
   - Provider
   - Mode
   - Clarify
   - Loop
7. `+` 在 MVP 只支持添加图片和上传文件，单个附件必须小于 `10MB`。
8. 不设置单独 Scope 按钮；用户通过 `@workspace`、`@file` 或其他 `@` 引用表达作用域。
9. Provider 控件打开 provider/runtime 设置，包括 provider、model id、thinking strength、permission mode 和 fast mode。
10. Mode 只有两种：

- `Quick`: 回答和快速动作，不进入合同冻结、Plan+Exec、Review 或 Loop。
- `Loop`: 正式任务，进入澄清、合同冻结、异步执行、审查和 loop。

11. Clarify 控制澄清强度，对 `Quick` 和 `Loop` 都生效。
12. Loop 控制循环强度，只在 Mode = `Loop` 时生效；Mode = `Quick` 时灰色不可用。
13. 如果用户不确定该选哪个模式，后续可以提供“推荐模式”能力；推荐必须来自 provider session，而不是本地规则猜测。

## 8. 两种任务模式的体验

1. `Quick`：
   - 包含问答和快速动作。
   - 不进入合同冻结、Plan+Exec 或 Review。
   - 不进入正式 task loop。
   - 不展示合同冻结卡。
   - 可以回答 `hi`、解释状态、总结报告、生成 commit message、做 git commit/git push、小范围编辑或一次性搜索。
   - 如果需要写操作或高风险操作，权限由 Provider 中的 permission mode 和权限卡控制。
   - 对 `hi` 这类轻量输入，用户感知等待不应超过 `10s`。
   - 如果 Clarify 选择 `Don't Bother Me`，体验应尽量等价于裸 provider harness runtime。
2. `Loop`：
   - 用于正式任务。
   - 创建 task draft。
   - 进入 Clarify -> Contract Freeze -> Plan+Exec -> Review。
   - Review 失败后按 Loop 强度进入下一轮。
   - 适合从零实现功能、大范围重构、多阶段开发、高风险改动和需要验收证据的任务。
3. 语义判断必须发生在 provider session 中。
4. 本地 Thoth 只尊重用户显式选择、维护状态、执行权限检查和记录证据。
5. 本地 Thoth 不用自然语言启发式规则偷偷把输入分类成任务模式。
6. 如果用户选择的模式和 provider 判断明显冲突，Thoth 用卡片建议切换模式，并解释原因。

## 9. Quick 的典型体验

1. 用户把 Mode 设为 `Quick`，Clarify 设为 `Don't Bother Me`，然后输入：

   ```text
   hi
   ```

2. Thoth 直接把输入交给 provider harness runtime。
3. 用户看到 provider 的输出实时流式出现。
4. Thoth 不创建任务、不展示澄清卡、不展示合同冻结卡、不进入 Review。
5. 这个路径的体验应和 Paseo 式裸 provider session 基本一致。
6. 用户输入：

   ```text
   帮我整理一下这周的周报
   ```

7. 如果 Clarify 不是 `Don't Bother Me`，Thoth 可以先用 Clarify provider session 问一个关键问题。
8. 如果 Thoth 能找到足够来源，直接整理并输出周报、来源和未覆盖事项。
9. 如果缺少关键来源，只问一个问题，例如“这周周报以哪个 workspace 为主？”。
10. 用户输入：

```text
帮我去网上搜一下关于某个技术方向的最新新闻
```

11. Thoth 直接搜索、引用来源、标明日期、给出摘要和不确定性，不创建正式任务。
12. 用户输入：

```text
帮我 git push 一下
```

13. Thoth 先检查当前 workspace、branch、remote、dirty state、待 push commit 和目标远端。
14. 如果不是 full access / 信任模式，Thoth 弹出权限卡请求批准。
15. 如果是 full access / 信任模式，Thoth 直接执行，但仍记录检查结果和 push 证据。
16. 用户输入：

```text
把这个小文案改顺一点
```

17. Thoth 可以做小范围编辑并展示 diff 或修改摘要，不进入正式任务循环。
18. 如果短动作失败原因变复杂，Thoth 不假装还在忙，而是建议切换为 `Loop`。

## 10. 默认澄清体验

1. 默认 Clarify 设置为 `auto`。
2. Thoth 不会把所有可能问题一次性倾倒给用户。
3. Thoth 会先自己整理：
   - 目标
   - 不做什么
   - 约束
   - 验收方式
   - 风险
   - 需要用户拍板的点
4. 然后展示一张或多张澄清卡。
5. 每张卡只包含少量关键问题。
6. 问题必须是会影响执行或验收的问题。
7. 能由 Thoth 自己从 workspace 调查出来的信息，不要求用户回答。
8. 用户可以逐项选择、输入补充，或要求 Thoth 解释为什么需要问。
9. `Quick` 不进入合同冻结流程，但 Clarify 仍然影响它是否先问一个必要问题。
10. 澄清卡的目标不是穷举边界，而是让 Thoth 提出少量真正影响方向、风险或验收的黄金问题。
11. Clarify 选项：

- `auto`: 由 provider-backed session 根据输入、workspace、风险和用户历史偏好选择澄清力度。
- `Don't Bother Me`: 不主动追问，尽量使用可验证默认值；遇到无法安全默认的高影响缺口时必须停下汇报。
- `light`: 少问，只问会明显改变方向、权限或验收的问题。
- `Balanced`: 平衡模式，问少数黄金问题。
- `deep`: 深度澄清，适合高成本、高风险、验收复杂或用户想先设计清楚的任务。

12. Clarify 对 `Quick` 和 `Loop` 都生效。
13. Clarify 只影响 Thoth 如何组织 provider session，不是模型或 thinking strength 选择。
14. Clarify provider session 的权限是只读。
15. Clarify 可以读取文件、查看 git 状态、搜索代码、查看日志、联网查资料和整理资料。
16. Clarify 不能修改文件、安装依赖、提交代码、删除文件或启动会改变 workspace 的动作。
17. Clarify 中途的用户讨论、关键回答、默认值、假设和决策点都会被记录。
18. 对 `Loop`，这些记录会被整理成一份执行前 handoff packet，后续 Plan+Exec 一次性读取它。

## 11. 合同冻结卡

1. 当 Clarify provider session 给出足够清楚的任务合同草案时，Thoth 展示合同冻结卡。
2. 合同冻结卡是正式任务进入执行前的必经确认。
3. 合同冻结卡不要求用户填完整表单。
4. 它只确认目标、边界、验收、风险和关键默认策略。
5. 卡片包含：
   - 我理解的目标
   - 明确不做的内容
   - 关键约束
   - 验收方式
   - 主要风险
   - Thoth 将默认采用的处理方式
   - 是否存在人工验收
6. 用户可以点击确认。
7. 用户也可以点击修改，让 Thoth 回到澄清。
8. 用户确认后，任务草稿变成就绪任务。
9. 就绪任务进入队列，等待执行。
10. 用户确认合同后，Thoth 不再把普通澄清问题反复推给用户。
11. 如果后续 provider 在 Plan+Exec 中再次提出澄清类问题，Thoth 默认按合同和推荐首选项自动回答，并在任务记录里标注。
12. 如果后续 provider 请求高风险权限，Thoth 仍然展示权限卡，不能用自动回答绕过。

## 12. 任务进入异步执行

1. 用户确认合同冻结卡后，不需要盯着任务。
2. Thoth 将任务放入该 workspace 的执行队列。
3. 如果当前没有正在写 workspace 的执行任务，Thoth 开始执行。
4. 如果已有写执行任务在运行，新任务排队。
5. 进入执行后，用户能实时看到 provider 的输出、工具事件、计划进度、执行进度和权限请求。
6. Plan 和 Execute 对用户表现为同一个连续执行过程。
7. 如果 provider 支持原生 plan mode，用户看到 provider 自己的 plan mode 流程，而不是 Thoth 自己伪造的计划器。
8. 用户可以关闭窗口。
9. 用户可以去手机端查看进展。
10. 用户可以继续在同一个 workspace 澄清下一个任务。
11. 用户可以随时打开任务详情查看当前状态。
12. Loop 强度只在 Mode = `Loop` 时生效；Mode = `Quick` 时显示为灰色不可用。
13. Loop 选项：

- `auto`: 由 provider-backed session 根据任务风险、失败模式和成本判断 loop 策略。
- `One Plan, One Do`: 只做一次 Plan+Exec 和一次 Review，失败后直接阻塞并汇报。
- `light`: 少量自动推进，更快阻塞并汇报，减少自动消耗。
- `balanced`: 默认有限重试，要求每轮解决上一轮未解决的问题。
- `Run Until Stopped`: 红色高消耗模式，会持续推进直到用户手动停止。

14. `Run Until Stopped` 不是无限放权；它仍受 provider availability、权限策略、安全硬停、资源上限和用户手动停止控制。
15. 无论 loop 强度如何，每轮 loop 都必须说明上一轮没有解决什么，以及本轮如何针对该问题推进。

## 13. 任务列表和队列

1. 每个 workspace 有自己的任务列表。
2. 任务状态用人话展示，例如：
   - 待你确认
   - 排队中
   - 正在处理
   - 正在检查
   - 需要你批准
   - 未通过，等待决定
   - 已完成
3. 默认视图显示摘要：
   - 任务标题
   - 当前状态
   - 下一步
   - 是否需要用户处理
   - 最近更新时间
4. 用户可以展开任务详情。
5. 展开后可看到：
   - 阶段进展
   - 关键证据
   - diff 摘要
   - 验收结果
   - 日志入口
   - 最终报告
6. 用户可以手动调整队列顺序。

## 14. 同 workspace 写执行串行、其他阶段可并行

1. 同一个 workspace 同一时间只允许一个会写入项目文件的执行任务运行。
2. 这样避免多个任务同时修改同一项目导致冲突。
3. 用户仍然可以同时：
   - 继续澄清其他任务草稿
   - 查看已有任务状态
   - 阅读报告
   - 回答权限卡
   - 在 global chat 问状态
4. 如果另一个任务排队中，用户可以调整优先级。
5. 如果用户打开另一个 git worktree 作为独立目录，它在 Thoth 中被视作另一个 workspace。

## 15. 权限/批准卡片

1. 低风险、workspace 内、边界清楚的读取、编辑和验证可以自动进行。
2. 高风险操作必须打断并让用户确认。
3. 需要确认的操作包括：
   - 写出 workspace 外
   - 删除或覆盖重要文件
   - 大规模移动文件
   - 安装依赖
   - 联网发布
   - 读取或写入密钥
   - git push
   - 长时间或高成本任务
4. 权限卡片必须说明：
   - Thoth 想做什么
   - 为什么需要
   - 影响范围
   - 不批准会怎样
5. 默认模式下，用户每次只对当前风险点拍板。
6. MVP 不记住“永远允许”。
7. 用户可以在 App 或 CLI 中开启 full access / 信任模式。
8. 在 full access / 信任模式下，高风险操作不弹审批卡。
9. 即使跳过审批，Thoth 仍然记录操作、范围、证据和结果。
10. 如果用户关闭 full access，后续高风险操作恢复审批卡。

## 16. 检查通过后的自动 commit

1. 执行完成后，Thoth 进入检查阶段。
2. 检查通过后，Thoth 默认自动 commit。
3. commit 只包含 Thoth 为该任务生成的 diff。
4. 正式任务的写执行默认在 Thoth-created branch 或 worktree 中进行。
5. commit 发生在任务分支或任务 worktree 中。
6. Thoth 不自动 push。
7. git push 是高风险直接处理，需要审批或 full access / 信任模式。
8. 如果 workspace 在任务开始前已有用户未提交改动，Thoth 会保留基线记录。
9. 如果 Thoth 生成的 diff 与用户原有改动没有冲突，Thoth 只提交自己生成的部分。
10. 如果出现同文件或同 hunk 冲突，Thoth 暂停并显示卡片，请用户决定怎么处理。
11. 完成后，任务报告中显示 commit 摘要和验收结果。

## 17. Review 失败后的有限轮自动修正与最终阻塞汇报

1. 检查发现问题时，不直接让审查者修改代码。
2. Thoth 把问题回传给下一轮 Plan+Exec。
3. `balanced` 默认最多进行 3 轮 Plan+Exec 和 Review。
4. 每一轮都记录：
   - 上轮失败原因
   - 上轮根因判断
   - 本轮策略变化
   - 本轮要补的核心证据
   - 禁止重复上一轮无效动作
   - 新证据
   - 检查结论
5. 如果下一轮没有新的策略变化，Thoth 不机械 retry。
6. 如果上一轮卡在验收证据不足，下一轮优先补验收证据。
7. 如果上一轮卡在方向错误，下一轮重新规划，而不是继续堆小修。
8. 如果上一轮卡在实现质量，下一轮集中修关键路径，而不是只补单测。
9. 如果 `balanced` 默认 3 轮后仍未通过，Thoth 停止自动修正循环。
10. 任务进入阻塞状态。
11. Thoth 向用户汇报：

- 目标是否部分完成
- 未通过的具体原因
- 已保留的 diff 和证据
- 建议下一步
- 是否需要用户继续授权

## 18. 没有自动验收器时的人工验收体验

1. 有些任务无法用自动命令完整判断是否成功。
2. 例如产品文案、视觉体验、策略设计、用户感受类任务。
3. 这类任务仍然可以注册成正式任务。
4. 合同冻结卡会明确标记人工验收项。
5. 检查阶段会检查：
   - 是否完成约定 artifact
   - 是否遵守约束
   - 是否提供足够说明和风险
   - 是否需要用户最终确认
6. 任务不会因为 AI 自评满意就自动宣告人工验收通过。
7. 用户会看到人工验收卡。
8. 用户可以选择通过、要求修改或终止。

## 19. TUI 的单 workspace 使用体验

1. 用户在某个项目目录中启动 TUI。
2. TUI 只面向当前 workspace。
3. TUI 没有全局 home。
4. 如果当前目录还不是 Thoth workspace，TUI 显示确认卡：
   - 是否将当前目录添加为 workspace
   - 当前路径
   - 当前 git 状态
5. 用户确认后进入该 workspace 控制台。
6. TUI 中可以完成：
   - workspace chat
   - 发起 `Quick`
   - 创建 `Loop` 任务
   - 回答澄清卡
   - 确认合同冻结卡
   - 查看任务队列
   - 查看执行进度
   - 批准权限卡
   - 阅读报告
   - 查看 provider 健康状态
7. TUI 的状态和桌面 app 中同一 workspace 的状态一致。
8. 用户在 TUI 中不需要关心全局其他 workspace。

## 20. 手机 app 的远程同步体验

1. 用户在桌面 app 中打开配对入口。
2. 桌面 app 显示二维码。
3. 用户用手机 app 扫码。
4. 配对成功后，手机端显示已连接的本机 Thoth 服务。
5. 手机端可看到：
   - workspace 列表
   - 任务列表
   - 当前状态
   - 待确认卡片
   - 最近报告
6. 手机端可以对已有 workspace 发起 `Quick` 或 `Loop`。
7. 手机端可以回答澄清问题。
8. 手机端可以批准权限和决策卡。
9. 手机端可以查看最终报告。
10. 手机端不提供直接选择本机文件夹的能力。
11. 手机端不做重型代码 diff 编辑。
12. 手机端不承担完整 IDE 体验。

## 21. 离线状态

1. 如果手机端无法连接本机 Thoth 服务，显示 offline marker。
2. 离线时手机端展示最近缓存的只读状态。
3. 离线时用户不能发送新任务。
4. 离线时用户不能批准权限卡。
5. 离线时用户不能确认合同冻结卡。
6. 重新连接后，手机端自动补齐历史。
7. 补齐后，用户看到最新任务状态和待处理卡片。

## 22. CLI、Claude、Codex、ACP 入口

1. CLI 是高级入口，可用于当前 workspace 的状态、`Quick`、`Loop` 和 diagnostics。
2. Claude 入口可以把用户消息交给同一 Thoth authority。
3. Codex 入口可以把用户消息交给同一 Thoth authority。
4. ACP 入口用于支持 ACP-compatible harness。
5. 这些入口不拥有独立任务语义。
6. 同一条 `Quick` 或 `Loop` 在这些入口、桌面 app、手机 app 和 TUI 中看到的是同一份状态。
7. Relay 只负责远程加密连接和同步，不改变任务生命周期。

## 23. 最小 Quick 使用路径

1. 用户打开桌面 app、手机 app、TUI、CLI、Claude、Codex 或 ACP 入口。
2. 用户输入一个清晰短动作，例如：

   ```text
   帮我 git commit 一下
   ```

3. 用户在 composer 中选择 `Quick`；如果来自非桌面入口，则等价参数为 `quick`。
4. 如果 Clarify 是 `Don't Bother Me`，Thoth 直接进入 provider harness runtime passthrough。
5. 如果 Clarify 不是 `Don't Bother Me`，Thoth 先用只读 Clarify provider session 处理必要上下文。
6. Thoth 做 workspace 和 git preflight。
7. 如果需要审批且未启用 full access / 信任模式，Thoth 展示权限卡。
8. 用户批准后，Thoth 执行操作。
9. 如果启用 full access / 信任模式，Thoth 直接执行操作。
10. 用户看到 provider 输出实时流式显示。
11. Thoth 记录 timeline、证据和最终结果。
12. 用户在任一入口看到同一结果。

## 24. 最小 Loop 使用路径

1. 用户打开桌面 app。
2. 用户完成 provider setup。
3. 用户添加一个 workspace。
4. 用户进入 workspace 页面。
5. 用户把任务模式设为 `Loop`，然后输入一段自然语言需求。
6. Thoth 按正式任务路径处理该输入。
7. Thoth 创建任务草稿。
8. Thoth 用均衡澄清卡询问关键问题。
9. 用户回答。
10. Thoth 展示合同冻结卡。
11. 用户确认。
12. 任务进入队列。
13. Thoth 创建 Plan+Exec provider session，并把冻结合同和澄清 handoff packet 一次性喂给它。
14. Provider 使用自己的 plan mode 完成计划和执行，输出实时流式显示。
15. 如果 Plan+Exec 中出现普通澄清问题，Thoth 自动按合同或推荐首选项回答并记录。
16. 如果 Plan+Exec 遇到高风险权限请求，Thoth 请求批准。
17. 用户在桌面或手机端批准。
18. Thoth 完成 Plan+Exec 后启动独立 Review session。
19. Review 检查通过。
20. Thoth 在任务分支或任务 worktree 中自动 commit 当前任务生成的 diff。
21. Thoth 输出最终报告。
22. 用户在桌面、手机或 TUI 中看到同一任务已完成。
