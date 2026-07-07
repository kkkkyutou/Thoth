# Harness Question And Clarify Research

## Status

1. 日期：`2026-07-04`
2. 性质：Claude Code `AskUserQuestion`、Codex `request_user_input`、OpenCode `question` / `question.asked` 调研结论
3. 目的：为 Thoth Clarify、provider-question、permission-card、contract freeze 后 auto-answer 设计提供依据
4. 范围：官方文档、本机 Codex schema、Multica 源码、Paseo 源码、OpenCode docs/source、Claude Code prompt extraction 公开资料、本机 Claude Code binary strings 旁证
5. 非目标：不实现 runtime，不替代 `.agent-os/designs/*` canonical authority

## 1. Verdict

Claude Code `AskUserQuestion`、Codex `request_user_input`、OpenCode `question` / `question.asked` 都是 provider / harness 原生的用户输入 transport。

它们解决：执行中暂停、provider 把问题交给 host、host 展示问题、host 把答案序列化回 provider。

它们不完全解决：什么时候该问、问什么是黄金问题、哪些事实应 agent 自己查、如何避免字段问卷化、如何把模糊意图收敛成可验收合同、如何区分 clarification / permission / Task Card approval、如何在 contract freeze 后避免 PlanExec 反复问用户。

但最新可见 prompt / tool description 暴露出一个明确方向：

1. OpenCode `question` 是较宽口径的 execution-time question tool，允许偏好、需求、方向、实现选择等执行中问题。
2. Claude Code `AskUserQuestion` 是窄口径的 genuine user-owned decision blocker，只有答案会改变下一步行动、且无法从请求/代码/合理默认值解决时才问。
3. Claude Code 还把 “clarify 前先 read-only research” 写成系统提示：先 grep / 查 docs / 查 memory，再问更具体的问题。
4. Thoth 应吸收 Claude Code 的窄口径和 research-first 原则，而不是把 OpenCode 的宽口径直接变成产品语义。

对 Thoth 的结论：

1. Thoth Clarify 不能是某个 native question tool 的薄封装。
2. `AskUserQuestion` / `request_user_input` / `question.asked` 应进入 Thoth `ProviderQuestionEvent` 或 `ClarificationCardCandidate` 层。
3. Thoth 产品语义仍由 `thoth.clarify` secretary skill、行为树收敛规则、daemon validator、authority store、evidence ledger 定义。
4. UI 可复用类似 Paseo question card 的能力，但不暴露 `request_user_input`、`AskUserQuestion`、`permission question`、provider role、packet、state code、raw JSON。

一句话：三家工具都提供“问用户”的管道，但 Thoth 必须拥有“该不该问、问什么、如何记账、何时停止问”的 authority。

## 2. Source And Evidence Map

| Category                     | Source                                                                                                   | Key Evidence                                                                                                                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude official              | `https://code.claude.com/docs/en/agent-sdk/user-input`                                                   | `AskUserQuestion` 和 tool approval 都触发 `canUseTool`；执行暂停直到 host 返回；问题/options 由 Claude 生成；host 只展示和回传；1-4 questions、每题 2-4 options；subagents 当前不可用；复杂输入用 custom tools                                                                             |
| Claude extracted prompts     | `Piebald-AI/claude-code-system-prompts`                                                                  | README 说明从 Claude Code 编译包抽取 prompt/tool-description 字符串；`tool-description-askuserquestion.md`、decision guidance、preview field、clarifying-question research-first prompt 暴露真实使用门槛和约束                                                                             |
| Claude local binary evidence | `/root/.local/share/claude/versions/2.1.159` via `strings`                                               | 本机可观察到 `AskUserQuestion`、`multiSelect`、`previewFormat`、unique question/option labels、plan-mode guidance、preview guidance 等字符串；只作为旁证，不视为公开稳定 API                                                                                                               |
| Codex official/schema        | `https://developers.openai.com/codex/app-server` + `codex app-server generate-json-schema`               | 本机 `codex-cli 0.134.0` schema 有 `item/tool/requestUserInput`；`ToolRequestUserInputParams` 标注 `EXPERIMENTAL`；required: `itemId/threadId/turnId/questions`；question required: `id/header/question`；optional: `options/isOther/isSecret`；response: id-keyed `{ answers: string[] }` |
| OpenCode official            | `https://opencode.ai/docs/tools/`                                                                        | `question` tool 可让 LLM execution 中问用户；每题有 header、question text、options；用户可选 option 或 custom answer；页面 last updated `Jul 3, 2026`                                                                                                                                      |
| OpenCode source              | `sst/opencode` / `anomalyco/opencode` raw source                                                         | `QuestionTool` 使用 `question.txt` 作为 tool description；`QuestionTool` 调 `question.ask`；runtime 发布 `question.asked`；host `reply/reject` 后发布 `question.replied/question.rejected`；answer 是 ordered `string[][]`                                                                 |
| Multica Claude               | `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/claude.go`                                         | Claude 以 non-interactive `stream-json` 跑，显式 `--disallowedTools AskUserQuestion`；注释说明否则问题可能用户看不到、返回 empty answer、agent silent infer                                                                                                                                |
| Multica OpenCode             | `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/opencode.go`                                       | OpenCode daemon-mode 使用 `--dangerously-skip-permissions`，并说明不依赖 `OPENCODE_PERMISSION`，避免 `permission.question` 被 wildcard allow 绕过                                                                                                                                          |
| Paseo Claude                 | `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/claude/agent.ts`           | `AskUserQuestion` -> `kind="question"`；host 加 `allowOther`；回传时把 UI header-keyed answers 映射成 Claude 要求的 full-question-text keys                                                                                                                                                |
| Paseo Codex                  | `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/codex-app-server-agent.ts` | `request_user_input` -> timeline `tool_call` + `permission_requested(kind="question")`；UI header-keyed answers 映射为 Codex id-keyed answers；存在 first-option fallback 风险                                                                                                             |
| Paseo OpenCode               | `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/opencode-agent.ts`         | 监听 `question.asked`；`multiple` -> `multiSelect`；加 `allowOther`；emit `permission_requested(kind="question", name="question")`                                                                                                                                                         |
| Paseo UI                     | `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/app/src/components/question-form-card-core.ts`               | question card 支持 options、multiSelect、allowOther/isOther、allowEmpty、dismiss、header-keyed answers                                                                                                                                                                                     |

Repro command:

```bash
codex --version
codex app-server generate-json-schema --out /tmp/codex-app-schema.XF4YEd
```

## 3. Claude Code `AskUserQuestion`

机制：

1. Claude 请求用户输入有两类：tool approval 和 clarifying question。
2. 两类都走 `canUseTool` callback。
3. `AskUserQuestion` 不是普通 assistant text，而是 tool-use / permission callback 机制的一部分。
4. callback pending 时 Claude execution 暂停。
5. Claude 生成 questions/options；host 展示并回传。
6. host 不能把自己的问题塞进 `AskUserQuestion` flow；应用自己的问题要单独做。
7. 如果限制 `tools` array，要包含 `AskUserQuestion`，否则 Claude 不能问澄清问题。

Shape：

1. request：`questions[]`，每题有 `question/header/options/multiSelect`。
2. `header` 是短 label，官方文档写 max 12 chars。
3. `options` 通常 2-4 个，每个有 `label/description`；TypeScript 可有 option `preview`。
4. response：`questions` 原样传回，`answers` 用完整 question text 做 key。
5. free text / Other 是 host UI path，不是 Claude options 原生项。

Paseo 映射：

1. `normalizeClaudeAskUserQuestionRequestInput` 给每题加 host-only `allowOther: true`。
2. `resolvePermissionKind` 把 `AskUserQuestion` + questions array 映射为 `kind="question"`。
3. `normalizeClaudeAskUserQuestionUpdatedInput` 把 `{ Provider: "Claude" }` 映射成 `{ "Which provider should I use?": "Claude" }`，并 strip host-only `allowOther`。

Multica 映射：

1. Claude / CodeBuddy 都加 `--disallowedTools AskUserQuestion`。
2. 原因：non-interactive stream-json daemon 没 UI render prompt；调用可能返回 empty answer；agent silent infer；用户看不到问题。

Thoth 含义：

1. 只有 Thoth daemon/UI/relay/pending state 能可靠承接时才启用 native question。
2. 不能承接时应禁用 native question，改用 Thoth `C_ASK` packet 或普通 text。

Extracted preset prompt / tool description 要点：

1. 核心门槛：只在被真正属于用户的决策阻塞时使用；该决策不能从请求、代码或合理默认值中解决。
2. `2.1.173` decision guidance：如果用户答案不会改变下一步行动，就不该问；常规默认值自己选；可在代码库验证的事实自己查。
3. `2.1.173` research-first prompt：澄清问题会打断用户；问之前最多花约一分钟做 read-only investigation，例如 grep 代码、查 docs、查 memory，让问题更具体。
4. Plan mode guidance：不要用 `AskUserQuestion` 问 “计划可以了吗 / 是否继续”；需求澄清和方案选择才用它，计划审批走 `ExitPlanMode`。
5. UI custom input：用户总能选择 Other / 自定义输入；模型不要把 `Other` 或兜底项塞进 options。
6. Recommended option：若有推荐，推荐项放第一，label 追加 `(Recommended)`。
7. Multi-select：多选用 `multiSelect: true`，且题目措辞要说明可多选。
8. Preview：只在单选题且用户需要视觉比较时使用；适合 UI mockup、代码方案、diagram；不用于简单偏好题。

Observed schema / validation hints:

1. 每次 `AskUserQuestion` 1-4 个问题，每题 2-4 个选项。
2. 问题文本必须唯一；同一题内 option label 必须唯一。
3. `question` 应清晰、具体，并以问号结尾。
4. `header` 是短 chip/tag；官方 Agent SDK 文档写 max 12 chars。
5. option label 应短，约 1-5 words；description 说明含义、后果或 trade-off。
6. preview HTML 必须是 self-contained fragment；不要 `<html>/<body>` wrapper；不要 `<script>` / `<style>`；用 inline style。
7. preview 只支持 single-select，不支持 `multiSelect`。

Claude Code 产品含义：

1. `AskUserQuestion` 不是“问卷工具”，而是“用户决策阻塞点工具”。
2. `AskUserQuestion` 不是 approval tool；approval / permission / plan approval 都有独立路径。
3. 真实策略是 self-investigate -> pick sensible default -> ask only if user answer changes action。
4. 这比 OpenCode 的 execution-time question 更接近 Thoth 的 CEO 私人秘书模型。

## 4. Codex `request_user_input`

机制：

1. Codex app-server 发 server request：`item/tool/requestUserInput`。
2. params 包含 `itemId/threadId/turnId/questions`。
3. host 展示问题并回传 `answers`。
4. Codex 继续 turn。

本机 schema 摘要：

1. `ToolRequestUserInputParams`：`itemId: string`、`threadId: string`、`turnId: string`、`questions: Question[]`。
2. `Question`：required `id/header/question`，optional `options/isOther/isSecret`。
3. `Option`：required `label/description`。
4. `ToolRequestUserInputResponse`：`answers: Record<questionId, { answers: string[] }>`。
5. 该协议当前 schema 标注 `EXPERIMENTAL`。

Paseo 映射：

1. `normalizeCodexQuestionPrompts` 需要 `id/header/question`，保留 `multiSelect/isOther/isSecret`。
2. `mapCodexQuestionRequestToToolCall` 生成 timeline `tool_call`，`name="request_user_input"`。
3. `handleToolApprovalRequest` 创建 `permission_requested(kind="question")`。
4. UI header-keyed answer 例如 `{ Confirm: "Yes" }` 被映射为 Codex id-keyed `{ confirm_path: { answers: ["Yes"] } }`。

风险：

1. Paseo 在 allow 但没有 mapped answers 时可 fallback 到每题第一个 option。
2. Thoth Clarify 不能照搬：这会伪造用户选择。
3. 自动选择只允许在用户明确“你决定”、contract freeze 后 auto-answer policy、或明确 agent-owned assumption 中发生。
4. 所有自动选择必须记录为非用户决策 evidence。

## 5. OpenCode `question` / `question.asked`

机制：

1. LLM 调用 OpenCode 内置 `question` tool。
2. `QuestionTool.execute` 调 `question.ask(...)`。
3. `question.ask()` 生成 id，放进 pending map，发布 `question.asked`。
4. host reply 或 reject。
5. runtime 发布 `question.replied` 或 `question.rejected`。
6. tool execute 恢复，并把用户答案作为 tool output 返回给 LLM。

Observed schema：

1. `QuestionInfo`：`question/header/options/multiple?/custom?`。
2. `Option`：`label/description`。
3. `QuestionRequest`：`id/sessionID/questions/tool?`。
4. `QuestionReply`：`answers: string[][]`。
5. event types：`question.asked`、`question.replied`、`question.rejected`。

Preset prompt / tool description 要点：

1. OpenCode `question` 用于 execution 中向用户提问。
2. 用途包括收集偏好/需求、澄清模糊指令、请求实现选择、给用户方向选择。
3. `custom` 默认启用，host 会自动添加自定义输入；模型不要自己提供 `Other` 或 catch-all 选项。
4. answers 返回为按问题顺序排列的 label arrays。
5. 多选字段是 `multiple: true`。
6. 若有推荐项，推荐项放第一，label 追加 `(Recommended)`。

OpenCode schema annotations：

1. option `label`：展示文本，约 1-5 words，要求 concise。
2. option `description`：解释选择。
3. `question`：完整问题。
4. `header`：非常短的 label，源码 schema 写 max 30 chars。
5. `options`：可用选择。
6. `multiple`：允许多选。
7. `custom`：允许自定义输入，默认 true。
8. reply `answers`：按问题顺序返回；每个答案是 selected labels array。

OpenCode 产品含义：

1. 它是一个更通用、更宽的 question transport。
2. 它的 prompt 没有 Claude Code 那种 “only when genuinely user-owned decision” 门槛。
3. 因此 Thoth 不能直接继承 OpenCode 的 should-ask policy。
4. Thoth 可以借用 OpenCode 的 asked/replied/rejected event lifecycle 和 ordered answers，但 should-ask 规则必须由 Thoth authority 判断。

Paseo 映射：

1. 监听 `question.asked`。
2. session mismatch 则忽略。
3. 每题必须有 `question/header`。
4. `multiple === true` -> `multiSelect: true`。
5. 加 `allowOther: true`。
6. emit `permission_requested(kind="question", provider="opencode", name="question")`。
7. real e2e 强制 OpenCode ask exactly one clarifying question，并断言 pending permission `kind === "question"`。

Multica contrast：

1. OpenCode daemon-mode 使用 `--dangerously-skip-permissions`。
2. 注释说明不依赖 `OPENCODE_PERMISSION`，避免 `permission.question` 与 wildcard allow 的 merge/order 绕过。
3. 当前 OpenCode run sessions 会注入 question / plan deny rules。

Thoth 含义：

1. OpenCode native question 可用，但权限配置、full-access、skip-permission 会改变行为。
2. Driver 必须做 capability diagnostics 和 conformance test。

## 6. Cross-Provider Comparison

| Dimension           | Claude                             | Codex                            | OpenCode                                  |
| ------------------- | ---------------------------------- | -------------------------------- | ----------------------------------------- |
| Native object       | `AskUserQuestion` tool             | app-server `request_user_input`  | `question` tool                           |
| Callback/event      | `canUseTool`                       | `item/tool/requestUserInput`     | `question.asked`                          |
| Answer key          | full question text                 | question id                      | ordered arrays                            |
| Custom answer       | host-side Other                    | `isOther`                        | `custom`, default true in observed schema |
| Secret              | not observed                       | `isSecret`                       | not observed                              |
| Multi-select        | `multiSelect`                      | adapter optional                 | `multiple`                                |
| Permission relation | shares `canUseTool` with approval  | Paseo maps to `kind=question`    | Paseo maps to `kind=question`             |
| Main risk           | noninteractive host hides question | experimental + fallback behavior | config/full-access affects surfacing      |

Prompt philosophy comparison:

| Dimension             | Claude Code `AskUserQuestion`                          | OpenCode `question`              |
| --------------------- | ------------------------------------------------------ | -------------------------------- |
| Ask threshold         | 窄：真正用户决策阻塞，且无法通过上下文/代码/默认值解决 | 宽：执行中需要问用户即可         |
| Pre-question research | 明确要求先做短 read-only investigation                 | tool description 未强制          |
| Default policy        | 常规默认值由 agent 选择并说明                          | 未强调 agent 自行默认            |
| User answer impact    | 用户答案必须改变下一步行动                             | 可用于偏好、需求、方向、实现选择 |
| Plan approval         | 禁止用它问计划是否可执行                               | 无同等 plan-mode 语义            |
| Product fit for Thoth | 更接近秘书式黄金问题                                   | 更适合作为通用 transport         |

Shared constraints:

1. 不把 `Other` 写进 options；custom input 由 host/UI 提供。
2. 推荐项放第一，并在 label 里标 `(Recommended)`。
3. 选项 label 短，description 解释后果。
4. 多选必须显式打开，并且选项可以不互斥。
5. tool result 必须清楚回传用户答案，让 agent 带着答案继续执行。

## 7. UI Substrate: Reuse Carefully

Paseo question card supports `question/header/options/multiSelect/allowOther/allowEmpty/placeholder/dismissLabel`。

Useful for Thoth:

1. multi-question navigation。
2. options and multi-select。
3. freeform / other。
4. dismiss / empty answer。
5. submitted readonly state。

Not reusable as product semantics:

1. user-visible “question permission” 心智。
2. provider header as canonical answer key。
3. `permission_requested` as Clarify authority event。
4. first-option default。
5. raw provider schema exposure。

## 8. Thoth Product Semantics

Borrow:

1. From Claude：approval 与 clarification 即使共用 callback，也必须语义分开；compact question limits；host-side Other；long-lived pending 需要持久 authority。
2. From Claude prompt extraction：只在真实用户决策阻塞时问；先调查再问；用户答案必须改变下一步行动；不要用 clarify 做 plan approval。
3. From Codex：app-server host-mediated request；`itemId/threadId/turnId` provenance；id-keyed answers；`isOther/isSecret`；experimental diagnostics。
4. From OpenCode：asked/replied/rejected event sequence；pending question list；`tool.messageID/callID` provenance；native question/permission event separation；custom input 默认由 host 提供。
5. From Paseo：shared card substrate；provider question normalization；timeline running/completed record。
6. From Multica：native question 不能可靠显示时禁用；non-interactive daemon mode 要显式策略；full-access 不代表 question 安全。

Do not borrow:

1. Claude “host 不能控制问题” 作为 Thoth 产品限制。
2. Paseo user-visible question-as-permission 心智。
3. Paseo unanswered fallback to first option。
4. Multica issue-comment-only clarification 作为 primary UX。
5. OpenCode `permission.question` config 作为 Thoth authority。
6. 任一 raw provider schema 作为 Thoth canonical card schema。
7. OpenCode 的宽口径 should-ask prompt 作为 Thoth should-ask policy。
8. Claude Code extracted prompt 的闭源文本本身作为 Thoth 可复制资产；只吸收原则，不复制实现。

## 9. Recommended Thoth Model

Driver event should normalize native questions into `ProviderQuestionEvent`:

1. ids：Thoth id、provider、native name、native request id。
2. stage：`clarify`、`quick`、`plan_exec`、`review`。
3. provenance：session id、turn id、item id、tool use id、raw input。
4. normalized questions：order、header、question、options、multiSelect、allowOther、allowEmpty、isSecret。
5. answer mapping：`claude_question_text_key`、`codex_question_id_key`、`opencode_ordered_answer_arrays`、`custom`。

Provider question should become `ClarificationCardCandidate`, not direct UI authority:

1. candidate id。
2. source：provider native question or `thoth_clarify_packet`。
3. clarify session id。
4. tree node id。
5. title / primary question。
6. why now。
7. decision it changes。
8. downstream branches affected。
9. risk if assumed。
10. default if skipped。

Validator must reject or repair if:

1. `decisionItChanges` missing。
2. `whyNow` missing during Clarify。
3. user answer would not change next action。
4. a conventional default is obvious and low-risk。
5. question asks agent-discoverable facts。
6. question asks for plan approval instead of requirement/approach clarification。
7. question downgrades user target。
8. question is field questionnaire。
9. options are unbounded or unstable。
10. options include model-authored `Other` / catch-all。
11. recommended option exists but is not first。
12. text too long for UI。
13. raw provider terms leak。
14. candidate contains executable UI instruction or command injection。

Authority events should split:

1. `provider_question.requested / answered / dismissed`
2. `permission.requested / approved / denied`
3. `clarification_card.candidate_received / validated / repaired / rejected`
4. `task_card_approval.requested`
5. `goal_card_approval.requested`

UI may share primitives; authority event types must remain separate.

## 10. Stage Policy

Universal ask gate:

1. Before any user-facing question, Thoth should do bounded read-only investigation when local evidence may answer it。
2. Ask only if the answer changes route、risk、scope、acceptance、provider action or user-visible artifact。
3. If a sensible default exists, use it, record the assumption and mention it when useful。
4. If the question is really approval, render an approval card, not Clarify。

Quick:

1. Covers normal answer、status query、concept explanation、summary、small edit、git push、one-shot command、web search。
2. No Draft Task、contract freeze、PlanExec、Review。
3. Permission preflight still applies。
4. Native provider question may be forwarded in passthrough mode。
5. If question implies multi-round diagnosis / broad writes / unclear acceptance, suggest Loop upgrade。

Clarify:

1. Provider question -> `ClarificationCardCandidate`。
2. Candidate must pass validator before render。
3. Invalid candidate becomes hidden evidence and repair prompt。
4. Repair targets same card / same tree node。
5. Failure shows calm state, not raw JSON/schema errors。

PlanExec after contract freeze:

1. Provider clarification should usually not bother user。
2. Auto-answer from frozen contract where possible。
3. If policy allows, auto-answer first recommended option, but record as policy decision, not user answer。
4. Permission requests are never auto-approved by question policy。
5. If question proves contract insufficient, block or return to explicit user decision path。

Review:

1. Review should rarely ask user questions。
2. If needed, it likely means acceptance contradicts evidence、user preference is required、or external state cannot be verified。
3. Review must not modify files；question should become blocking review decision card。

## 11. Driver Notes

Claude driver:

1. Detect `toolName === "AskUserQuestion"`。
2. Preserve original questions。
3. Add host-side `allowOther` only in UI model。
4. Strip host-only fields before returning。
5. Serialize answers by full question text。
6. Persist pending question in authority store；do not rely only on in-memory Promise。
7. If native question cannot surface reliably, disable it and use Thoth packet path。
8. Enforce extracted-prompt semantics at Thoth layer: do not show low-value questions that ask discoverable facts or plan approval。
9. Preserve `preview` only after sanitizer/surface support exists；otherwise strip or convert to text evidence。

Codex driver:

1. Handle `item/tool/requestUserInput`。
2. Preserve `itemId/threadId/turnId`。
3. Preserve `isOther/isSecret`。
4. Treat schema as experimental。
5. Return id-keyed answers。
6. Forbid silent first-option fallback in Clarify。
7. Record running/completed provider question evidence。

OpenCode driver:

1. Listen for `question.asked`。
2. Preserve request id、session id、tool message/call id。
3. Map `multiple` -> `multiSelect`。
4. Map `custom` -> `allowOther`。
5. Reply with ordered arrays。
6. Reject through native reject path。
7. Separate `permission.asked` and `question.asked`。
8. Test full-access / skip-permission behavior。
9. Do not inherit OpenCode's broad question policy as product behavior；run candidates through Thoth ask gate。
10. Preserve `custom` default in UI model, but do not let provider-authored `Other` become a canonical option。

## 12. Risks And Mitigations

1. Noninteractive host hides question：Multica disables Claude `AskUserQuestion` for this reason；mitigate by capability test or disable native question。
2. Question and permission collapse：Claude shares callback, Paseo maps to `permission_requested(kind=question)`；mitigate with separate authority events and UI semantics。
3. Silent first-option fallback：Paseo Codex can do this；mitigate by forbidding in Clarify and logging policy auto-answer separately。
4. Low-quality provider question：provider may ask discoverable facts or implementation trivia；mitigate with validator, repair loop, golden eval, independent judge。
5. Schema drift：Codex is experimental; OpenCode/Claude evolve；mitigate with conformance tests, diagnostics, raw request evidence, schema version recording。
6. Secret leakage：Codex has `isSecret`；mitigate with redaction policy for transcript/evidence。
7. Prompt drift：Claude Code tool descriptions change across versions；mitigate by treating extracted prompt as reference evidence, not canonical product contract。
8. Leaked-source supply-chain risk：public mirrors of leaked Claude Code source can be malicious；mitigate by preferring official docs, prompt-extraction repo metadata and local installed binary strings over unknown archives。
9. Over-asking：OpenCode's broad prompt can normalize frequent interruptions；mitigate with Claude-style ask gate and research-first requirement。

## 13. Prompt-Level Acceptance Checklist

For any Thoth clarify/question card:

1. Does this question survive a one-minute read-only investigation?
2. Does the user's answer change what Thoth does next?
3. Is there no safe conventional default?
4. Is it not a permission / plan approval / contract approval question?
5. Is it one titled card with a tight decision branch, not a field questionnaire?
6. Are there 2-4 meaningful choices?
7. Is the recommended choice first and marked as recommended when a recommendation exists?
8. Are `Other` / custom text provided by UI, not model-authored as an option?
9. Are option labels short and descriptions consequence-oriented?
10. Is multi-select used only when choices are genuinely compatible?
11. If preview is present, is it necessary for visual comparison and safe for the surface?
12. Can the answer be serialized back to the native provider without losing provenance?
13. Is the event recorded as question, permission or approval correctly?

## 14. Acceptance Scenarios

1. Claude native question：`AskUserQuestion` -> `ProviderQuestionEvent` -> validated card -> answer serialized by full question text。
2. Claude noninteractive path：driver disables `AskUserQuestion`; no empty-answer silent inference。
3. Codex request：`item/tool/requestUserInput` -> id-keyed answers -> no first-option fallback。
4. OpenCode question：`question.asked` -> `multiSelect/allowOther` mapping -> ordered answer arrays。
5. PlanExec after freeze：provider clarification auto-answered from frozen contract；permission not auto-approved。
6. Invalid Clarify question：target-downgrade or field-questionnaire candidate rejected and repaired before user sees it。
7. Quick passthrough：native question can be forwarded, but broad/unclear work recommends Loop upgrade。
8. Claude-style gate：agent-discoverable fact is answered by read-only investigation rather than surfaced as question。
9. OpenCode broad question：driver receives it, but Thoth rejects/repairs it if it asks a low-value preference with an obvious default。

## 15. Relation To Current Thoth Design

Current design already aligns:

1. Quick handles short bounded actions and does not enter loop。
2. Only `loop` enters Clarify -> Contract Freeze -> Attempt。
3. Clarify and Review are independent provider sessions。
4. Drivers stream provider text、tool calls、question events、permission events、completion events。
5. Drivers distinguish provider question events from permission events。
6. Provider question sources include Codex `request_user_input`、Claude `AskUserQuestion`、ACP/native question events、Clarify-generated golden questions。
7. During Clarify, provider questions become clarification cards。
8. During Quick passthrough, provider questions are forwarded like native provider。
9. During PlanExec after freeze, provider clarification questions are auto-answered from frozen contract or first recommended option。
10. Provider questions do not grant risky-tool permission。
11. `C_ASK` is not a field questionnaire and not Codex `request_user_input` semantics。

Relevant docs:

1. `.agent-os/designs/thoth-engineering-architecture.md`
2. `.agent-os/designs/thoth-app-runtime-contract.md`
3. `.agent-os/designs/thoth-mvp-loop-goals.md`

## 16. Recommended Next Work

1. Add `ProviderQuestionAdapter` contract in driver layer。
2. Add Claude / Codex / OpenCode fixture tests for native question parse and answer serialization。
3. Add `ProviderQuestionEvent` and separate authority events instead of reusing permission as canonical question event。
4. Add `ClarificationCardCandidate` validator and repair loop。
5. Add PlanExec after-freeze auto-answer policy with evidence。
6. Add golden tests for Claude key mapping、Codex id mapping、OpenCode ordered arrays、no first-option fallback、invalid target-downgrade question、permission not auto-approved。
7. Add prompt-level golden cases for research-first, user-answer-changes-action and no-plan-approval-through-clarify。

## 17. Open Questions

1. `rawInput` should persist full raw input, redacted input, or hash + redacted copy?
2. `isSecret` answers can enter Clarify transcript or must stay redacted?
3. Claude option `preview` should be supported? If yes, what sanitizer / sandbox?
4. How to identify “recommended option” provider-neutrally after contract freeze?
5. OpenCode `custom` default true is stable enough, or must runtime-probe?
6. In full-access / dangerously-skip-permissions mode, should native questions still surface?
7. Mobile offline pending question should pause provider session, defer, or reject?
8. Quick + Don't Bother Me should forward all native provider questions or still filter low-value questions?
9. Should Thoth support Claude preview HTML in MVP, or convert preview to text-only evidence until sanitizer is designed?
10. Should OpenCode `custom: false` ever be respected, or should Thoth always offer CEO freeform override?

## 18. Sources Added In This Revision

1. Claude Code extracted prompt repo: `https://github.com/Piebald-AI/claude-code-system-prompts`
2. Claude Code AskUserQuestion tool description: `system-prompts/tool-description-askuserquestion.md`
3. Claude Code AskUserQuestion decision guidance: `system-prompts/tool-description-askuserquestion-decision-guidance.md`
4. Claude Code AskUserQuestion preview guidance: `system-prompts/tool-description-askuserquestion-preview-field.md`
5. Claude Code clarifying-question research-first prompt: `system-prompts/system-prompt-clarifying-question-research-first.md`
6. OpenCode question tool description: `packages/opencode/src/tool/question.txt`
7. OpenCode question tool implementation: `packages/opencode/src/tool/question.ts`
8. OpenCode question schema: `packages/schema/src/v1/question.ts`

## 19. Final Recommendation

Use three layers:

1. Driver transport layer：receive Claude `AskUserQuestion`、Codex `request_user_input`、OpenCode `question.asked`; parse / normalize / serialize only。
2. Thoth authority layer：canonical `ProviderQuestionEvent`; separate question / permission / approval; stage policy show / auto-answer / reject / repair / block; preserve provenance and evidence。
3. Product Clarify layer：`thoth.clarify` decides whether to ask, what to ask and when to stop; `C_ASK` remains behavior-tree branch card; UI renders secretary decision cards, not provider-native terms。

Conservative implementation order:

1. Provider-question model。
2. Three provider adapters with fixture tests。
3. Card candidate validator。
4. APP card rendering。
5. PlanExec frozen-contract auto-answer。

This lets Thoth absorb current harness question capabilities without surrendering product authority to any one provider.
