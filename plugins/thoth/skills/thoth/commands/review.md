# $thoth review

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `review_packet`

## Objective

Produce the best possible review output: understand user intent, apply professional judgment and first-principles reasoning, and return structured findings without modifying code.

## Hard Stops

- Do not modify project code or write fixes.
- Do not reduce the review to a checklist; infer the user's intent from evidence and reason from first principles.
- If the target, intent, or acceptance bar is ambiguous, ask with AskUserQuestion before judging instead of assuming.
- If review_expectation or complete_exact exists, follow it exactly.

## Reply Contract

- reply_budget_utf8: `160`
- result_style: short summary plus structured findings
- validator_policy: exact-match route is protocol_fast; open-ended route stays live but still structured

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth review`, but in the workspace shell you must execute it literally as `thoth review`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=review_packet. Objective: Produce the best possible review output: understand user intent, apply professional judgment and first-principles reasoning, and return structured findings without modifying code. Hard stop: Do not modify project code or write fixes. Hard stop: Do not reduce the review to a checklist; infer the user's intent from evidence and reason from first principles. Hard stop: If the target, intent, or acceptance bar is ambiguous, ask with AskUserQuestion before judging instead of assuming. Hard stop: If review_expectation or complete_exact exists, follow it exactly. If the command returns a review packet, stay inside that review protocol only. If `packet.review_mode` is `exact_match`, reproduce that exact structured result. If `packet.protocol_commands.complete_exact` exists, execute that exact completion command. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
