# Change Decisions

## Purpose

Append-only 记录用户后续拍板与解释变化，不通过偷偷改写 `requirements.md` 来掩盖方向变化。

## Entries

- `CD-001` `2026-04-22` `[accepted]`: Thoth V2 的控制平面采用 `Thoth 主控`，外部 Codex 仅作每轮或显式子任务 worker
- `CD-002` `2026-04-22` `[accepted]`: 运行时真相模型为“repo ledger 为权威，SQLite 仅为派生索引/缓存”
- `CD-003` `2026-04-22` `[accepted]`: `/thoth:init` 的目标语义是“先审计，再 preview，再 apply”，而不是盲目 scaffold
- `CD-004` `2026-04-23` `[accepted]`: `dev` 分支保留开发态文档系统，`main` 不保留 `AGENTS.md`、`CLAUDE.md`、`.agent-os/`
- `CD-005` `2026-04-23` `[accepted]`: `dev -> main` 的默认集成策略为 `cherry-pick`
- `CD-006` `2026-04-23` `[accepted]`: 当前公开命令面保持显式 `/thoth:*`，内部协议层与内部 worker 不暴露为公开 slash surface
- `CD-007` `2026-04-23` `[accepted]`: `Codex` / `Claude Code` 平台知识采用“官方 docs 为 authority，仓库文档为缓存综合层”的治理模型
- `CD-008` `2026-04-23` `[accepted]`: dashboard 的长时运行真相采用 `task-first UI + run-ledger truth + smart polling` 模型
- `CD-009` `2026-04-23` `[accepted]`: 所有默认开发工作都在 `dev`，未经用户明确批准不得直接修改 `main`
- `CD-010` `2026-04-23` `[accepted]`: Thoth 的验证体系采用“双层门槛 + repo-real 默认 + host-real 自动追加”模型
- `CD-011` `2026-04-23` `[accepted]`: Codex 分发面按官方 plugin manifest/schema 对齐，但不改动 Claude Code 公开 surface 与 `.thoth` authority 边界
- `CD-012` `2026-04-23` `[accepted]`: `/thoth:init` 必须升级为 audit-first adopt/init
- `CD-013` `2026-04-23` `[accepted]`: 新功能开发必须同步兼顾 Claude Code 与 Codex，且开发完成后必须完成 `dev -> main -> push both -> update local installs` 收尾
- `CD-014` `2026-04-24` `[accepted]`: 严格任务执行模型固定为 `Decision -> Contract -> compiler-generated Task`，`run` / `loop` 默认只接受 `--task-id`
- `CD-015` `2026-04-24` `[accepted]`: 仓库的唯一保留上游切换为 `https://github.com/SeeleAI/Thoth`
- `CD-016` `2026-04-24` `[accepted]`: 公开仓库不保留个人邮箱、私人本地路径或外部项目来源链
- `CD-017` `2026-04-25` `[accepted]`: pytest 测试面固定分为 `light` / `medium` / `heavy` 三层；`light` 目标 `20s` 内、`medium` 目标 `2` 分钟内且包含 `light`、`heavy` 为全量，用于重构和最终收口
- `CD-018` `2026-04-25` `[accepted]`: `thoth/selftest.py` 的 heavy 主门禁改为最小 deterministic Python repo + 明确 validator + review-to-loop 闭环；不再把前端浏览器链路作为命令语义主证明
- `CD-019` `2026-04-25` `[accepted]`: 本轮只做 Thoth 整体代码简化；前提是不能丢功能、不能破坏既有目标与治理约束、不能放松现有验收语义
- `CD-020` `2026-04-25` `[accepted]`: Thoth 的设计要按高维分层重新冻结；`contract` 只是其中一层，层与层之间必须清晰解耦，且协议/数据高度确定
- `CD-021` `2026-04-25` `[accepted]`: 本轮只有在 `Codex-only` closing gate 真实通过后才算结束；之后仍必须按约束完成 `dev -> main -> push both`
- `CD-022` `2026-04-25` `[accepted]`: 本轮最高层骨架固定为 `Surface / Plan / Run / Observe`；其内部只保留七个实现子层，host difference 只允许停留在 `Surface / Host Adapter`
- `CD-023` `2026-04-25` `[accepted]`: 结果模型固定为 `RunResult + TaskResult`；run ledger 的长期 canonical 文件集固定为 `run.json`、`state.json`、`events.jsonl`、`result.json`、`artifacts.json`
- `CD-024` `2026-04-25` `[accepted]`: `TaskResult` 是长期存在但可重建的 task 当前态文件；`sync` 允许按 run 历史重建它，但不得伪造或改写历史 `RunResult`
- `CD-025` `2026-04-25` `[accepted]`: `review` 的 public contract 固定为 live-only；`loop` 只允许消费同 `task_id + target` 且晚于 `TaskResult.last_closure_at` 的 review findings
- `CD-026` `2026-04-25` `[accepted]`: 旧内部模块路径不做兼容保留；`thoth/runtime.py`、`thoth/task_contracts.py`、`thoth/project_init.py`、`thoth/claude_bridge.py`、`thoth/host_hooks.py` 直接从主实现中删除，全部切到新包级实现
- `CD-027` `2026-04-25` `[accepted]`: 本轮 closeout 先删除临时目录并提交当前 `dev` 工作，再只执行 `push origin dev`；`main` 的 cherry-pick、`push origin main` 与本机安装刷新暂缓，等待用户后续批准
- `CD-028` `2026-04-27` `[accepted]`: 若 `run` / `loop` 缺少 `--task-id`，Thoth 必须严格拒绝执行；只允许基于用户给出的 prompt 召回最接近的 `3` 个现有 task 候选并立即停下，禁止创建任何新 task，禁止在未拿到 `task-id` 前触碰项目代码
- `CD-029` `2026-04-27` `[accepted]`: `run` 固定为一次 `plan -> exec -> validate -> reflect` 的 Python 机械状态机；`loop` 固定为父级 bounded orchestrator，每轮显式创建独立 child `run`，预算来自 task authority 的 `runtime_contract.loop.*`，且 validator 输出必须满足严格 JSON schema
- `CD-030` `2026-04-28` `[accepted]`: 用户已批准按既定分支治理约束完成本轮收尾，即在 `dev` 上提交完整变更、仅将发布面代码 `cherry-pick` 到 `main`，并推送两个分支
- `CD-031` `2026-04-28` `[accepted]`: `heavy` 的关闭门语义重定义为“双宿主 public-command conformance gate”而不是“真实开发闭环 gate”；`heavy` 不再重跑 `hard`，总预算固定为 `300s`，固定命令矩阵为 `init/status/doctor/discuss/run/review/dashboard/loop/sync`，其中 `run/loop` 只验证 `--sleep` handoff / watch / stop 协议，`review` 必须 exact-match 固定单 finding，且不允许改动 probe repo 的 `tracker/` 源码
- `CD-032` `2026-04-28` `[accepted]`: 当前公开验证合同改为“atomic selftest cases + targeted pytest runs”。`python -m thoth.selftest` 只允许显式 `--case` 列表，发布/回归/关闭门都必须枚举 case IDs；`pytest` 默认只允许显式 file/nodeid 或 `--thoth-target`，裸 `pytest`、目录级 `pytest` 与 `--thoth-tier` broad runs 默认失败，只有 `--thoth-allow-broad` 或 `THOTH_ALLOW_BROAD_TESTS=1` 才允许豁免；仓库同时提供 `thoth/test_targets.py` 与 `scripts/recommend_tests.py` 作为固定推荐入口
- `CD-033` `2026-04-29` `[accepted]`: 统一对象图与 Agent Runtime Kernel 成为新的实现合同：`.thoth/objects/<kind>/<object_id>.json` 是唯一 canonical object authority；删除独立 `Contract` kind；`work_item.payload` 承载 goal、constraints、execution plan、eval、runtime policy 与 decisions；`run` 固定绑定 `work_id@revision` 且只做最小 phase chain；`loop` / `orchestration` / `auto` 属于 controller service；active run/controller 引用的 work item 在 terminal 前完全不可修改
- `CD-034` `2026-04-29` `[accepted]`: 本轮 Runtime Kernel 关闭门只包含核心五项 selftest：`discuss.subtree.close`、`run.phase_contract`、`run.locked_work`、`loop.controller`、`observe.object_graph`。`auto` / `orchestration` 保留已有代码、public surface 与测试覆盖，但本轮不深化、不 refactor、不纳入关闭门。
- `CD-035` `2026-04-29` `[accepted]`: 发布后本机安装刷新必须走远端 marketplace upgrade/update；禁止用本机 checkout、cache、临时目录、`rsync` 或其他本地覆盖方式刷新 Claude Code / Codex 的 Thoth 安装。若远端 upgrade/update 失败，只记录 blocker 与真实输出，不做本地兜底覆盖。
- `CD-036` `2026-04-30` `[accepted]`: `run` / `loop` 执行层统一为 RuntimeDriver；固定生命周期为 `plan -> execute -> validate -> reflect`，其中 `plan` 只做具体执行计划，不能改写目标、work item 或 validator；`validate.passed` 决定 terminal success/failure，`reflect` 总是记录证据、风险与下一步建议。`live` 与 `sleep` 只在 monitor/placement 上分叉：`live` 是前台阻塞 monitor，`--sleep` 是 detached 后台 monitor；不再把宿主手动 `next-phase` / `submit-phase` 当作 public live 协议。
- `CD-037` `2026-05-01` `[accepted]`: 公开命令面收敛为最小集合 `init / discuss / run / loop / review / auto / status / doctor / dashboard`；`sync` 下沉为 `init --sync`，`report` 下沉为 `status --report`，`orchestration` 与 `extend` 不再作为公开命令投影。
- `CD-038` `2026-05-01` `[accepted]`: `review` / `discuss` prompt authority 必须强化为专业判断与 first-principles discussion；`review` 默认不改代码，`discuss` 不得假设目标、约束、指标、资源、时间或 authority，必要时必须通过 `AskUserQuestion` 持续追问。
- `CD-039` `2026-05-06` `[accepted]`: `auto` 长时执行收紧为 durable background worker + observer monitor 分层；live session、sleep handoff、Claude `Monitor` 与 Codex watch 都只是观察器，执行正确性与恢复 authority 必须来自 `.thoth/objects/controller`、`.thoth/local/controllers/*/supervisor.json`、child run ledger 与 watch JSONL。
- `CD-040` `2026-05-08` `[accepted]`: Codex/Claude host-real 回归以安装态为准：Codex 插件包必须携带 runtime 与 skill，测试不得用本地 checkout/cache/rsync 兜底；Claude 宿主委派 Codex worker 必须通过真实 `--executor codex` 短运行验证；Codex hooks 只在 disposable test repo 的 `.codex/` 下启用，不写全局 `~/.codex`。
- `CD-041` `2026-05-09` `[accepted]`: `discuss` / runtime `plan` 的防漂移 authority 保存采用“语义无损结构化 + 短证据锚点 + 显式关闭”模型：长讨论可写 draft checkpoint，但只有 close 后才能生成 runnable work；闭环内容继续落在 `discussion`、`decision`、`work_item.payload.authority_context` 三对象中，不新增公开命令或新 object kind。`run` / `loop` 的 plan phase 必须证明 `authority_context` 覆盖完整；若存在 open gaps 或未授权假设，run 以 `needs_input` 失败并回到 `discuss`，不得进入 execute。
- `CD-042` `2026-05-14` `[accepted]`: `v0.2.0` stable compact release 将当前 public authority、runtime/read-model、dashboard/API/UI、README、CHANGELOG、generated plugin surfaces、selftest samples 与 init-generated agent instructions 统一收敛到 `work_item` / `work_id` / `work_kind` / `runnable`。当前 authority/read-model/runtime/dashboard 输出不得继续保留 `task_id` 或 `work_type=task` compatibility field；execution eligibility 以 `runnable=true` 为准。旧 `task_id` / `.agent-os/research-tasks` / `.thoth/project` 只允许作为 migration input 或 doctor rejection evidence 被读取，`doctor` 必须只读 FAIL 并指向 `thoth init --migrate apply`，只有 `init --migrate preview/apply` 可写新形状。Todo 的普通 `TodoTask` / `/api/todo/tasks` 与 Claude/Codex 宿主工具名 `Task` 不属于 Thoth runtime authority，不在本轮 rename 范围内。
- `CD-043` `2026-05-23` `[accepted]`: `auto` 的失败隔离语义固定为“哪个 work item 的 child run 真实启动并失败，哪个 work item 才记录 failed attempt”。Controller queue snapshot、controller-level failure、前一个 work item 的失败、dashboard 读面或 system-wide executor/auth failure 都不得批量把未尝试的 work item 标记为 failed attempt；`auto` 仍保持串行 child loop 执行，每个失败必须能追溯到对应 `work_id` 与 `run_id`。
- `CD-044` `2026-05-23` `[accepted]`: `validate` 的 command contract 从“逐字 official command 匹配”调整为“official validation evidence audit”。`eval_entrypoint.command` 是 reference validator command，不是限制 agent 正常工程判断的命令笼子；Codex/Claude Code execute worker 可以为真实环境选择 GPU、解释器、env 或薄 wrapper，只要保留 authority、validator intent、metric、threshold 与可审计证据。Thoth 应防止偷换验收，而不是限制 agent 手脚；命令字面 mismatch 只能作为 diagnostic，不能单独导致 run failed。
- `CD-045` `2026-05-23` `[accepted]`: `auto` preflight 可以自动修复由 canonical `.thoth/objects` 派生出来的 read-model/docs 漂移，例如 `.thoth/docs/object-graph-summary.json` 的 `work_item_counts` / `ready_work_count` stale；修复方式是刷新一次 object graph summary 并重跑 doctor，而不是直接忽略失败。真实 authority/safety failure，包括 invalid object、缺 project object、legacy authority、active controller drift 或刷新后仍存在的 doctor failure，仍必须阻断 `auto` 执行。
- `CD-046` `2026-05-23` `[accepted]`: `0.2.7.0` 将 work item authority 字段激进 compact：新写入只保留 `goal`、`context`、`constraints`、`acceptance_spec`、`approach_notes`、`scheduling`、`run_limits`、`missing_questions`，依赖和决策只通过 canonical links 表达。`auto` 改为 DAG-first / `scheduling.order` 排序，彻底删除 priority / priority-top public semantics。`run --reconcile` 从 public flag 删除，历史 run 进度恢复内收到 `plan` prompt 与 `history_action`；prompt 采用编号化类别结构，限制只围绕 authority / acceptance，不用机械字段束缚 Codex / Claude Code 的实现智能。
- `CD-047` `2026-05-24` `[accepted]`: 旧 public `review` command 删除，替换为 `argue` adversarial discussion surface。`argue` 不是代码 review，也不是 PASS/WARN/FAIL 打分器；它针对 idea / work item / decision 做 attacker 与 adjudicator 双 session 对抗讨论，输出 `decision_impact` 与完整 artifact。Authority mutation 默认禁止，只有用户显式确认 `--apply-artifact` 时才允许写 compact work payload 字段 `goal`、`context`、`constraints`、`acceptance_spec`、`approach_notes`、`missing_questions`；decision/history 等对象不做直接覆写。
- `CD-048` `2026-05-25` `[accepted]`: `execute -> validate -> reflect` receipt 契约采用“一套 canonical schema + validate 入口窄兼容”。`official_validation_receipt` 的落账字段保持 compact canonical，validate 可兼容 `actual_command`、`stdout`、`stderr`、`metric.value` 等自然别名并物化日志路径；authority / validator / metric / threshold / evidence preservation 由 validate 从事实推导，不再要求 execute 机械自证。Phase worker 顶层 unknown fields 归一化为丢弃 + warning，不再因 agent 多写解释字段杀 run；`reflect.corrective_prompt` 保留为 failed 的统一出口，但 runtime contract error 时它是 operator/runtime repair instruction，不代表允许 execute retry。
