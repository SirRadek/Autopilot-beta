# Model Output Evaluation Operating Model

Date introduced: 2026-06-11
Status: phase-1 learning-loop governance
Owner: Autopilot Control Plane

This operating model governs how Autopilot scores model and worker outputs,
tunes prompts or input packets, and decides when repeated weak output should
trigger a reasoning/model route review.

It is not a runtime queue, model gateway, prompt-management SaaS, or delivery
approval authority.

## Source Authority

Use this order:

1. local repository facts, tests, architecture records, work logs, and owner
   decisions
2. Decision Mesh and project mesh packets
3. local prompt contracts and eval records
4. Context7 when connected, then official provider documentation
5. advisory model output, treated only as a hypothesis until verified

## Score Dimensions

Every evaluated output is scored on a `0` to `100` scale using the relevant
dimensions:

- task fit
- instruction following
- source grounding
- format contract
- verification readiness
- privacy and safety
- handoff clarity
- token efficiency
- workflow compatibility for Codex, MCP, plugins, skills, and next-agent handoff

An output cannot be accepted without a score, source pointers, and verification
evidence. A score below `80` requires tuning, rerun, or a blocker. A repeated
similar failure count of `3` requires reasoning/model route review.

## Learning Phase

During the learning phase:

1. Score the model output before accepting it.
2. If the score is weak, record the failure labels and exact reason.
3. Apply Caveman or compact routing before adding more context or model spend.
4. Check provider-specific guidance through Context7 or official docs when the
   change depends on model behavior.
5. Change the prompt or input packet meaningfully.
6. Rerun and record the delta.
7. Repeat until the result is acceptable or blocked.

Do not rerun the same model with the same prompt/input unless the reason is
recorded.

## Provider Run Artifact Gate

External advisory providers have two separate artifacts:

1. the provider runner artifact: command/tool, status, stdout/stderr summary,
   prompt pointer, mode, and provider availability evidence
2. the model output artifact: the actual advisory answer to evaluate

The provider runner artifact is not model output. Shell transcripts, prompt
echoes, CLI syntax errors, trust-flag errors, login failures, and provider
availability failures must be recorded as control-plane diagnostics.

If provider execution failed, the artifact is prompt/log-only, or no model
output is present, Autopilot must set `blocked` or `waiting_owner` and stop
content review. It may not silently drop the provider, continue with a narrower
multi-model brainstorm, or pass the raw runner log as the next prompt.

Minimum run fields:

- provider and access path
- command or manual workflow pointer
- run status
- artifact kind: `model_output`, `runner_log`, `prompt_only`, `mixed_log`, or
  `unknown`
- whether model output is present
- blocking stop condition or owner/external dependency when output is missing

## Weekly Tuning

After enough eval records exist, routine prompt and input tuning should move to
a weekly batch:

- aggregate accepted, retry, blocked, and route-review records
- group repeated failure patterns by task type, model/worker, prompt version,
  token-efficiency profile, and tool/plugin/skill workflow surface
- propose prompt/input changes with source pointers and rollback
- keep prompts as candidates until eval evidence supports promotion

Weekly tuning cannot happen from anecdotes alone.

## Reasoning Or Model Changes

After repeated similar weak outputs:

1. Summarize the failure pattern.
2. Rerun `select_token_efficiency_route`.
3. Rerun `select_reasoning_model_route`.
4. Check provider availability, entitlement, cost, privacy, and source authority.
5. Prefer prompt/input fixes before model changes when the failure is prompt
   controllable.
6. Change reasoning effort or model/provider only when verified guidance and the
   failure pattern justify it.

Changing reasoning/model route does not approve the new output. The new output
must be scored and verified again.

## Provider Guidance

OpenAI:

- use evals and model optimization guidance for prompt iteration
- use structured outputs when format contract matters

Anthropic / Claude:

- define success criteria before prompt tuning
- use clear rubrics and examples for judgment tasks

Google / Gemini:

- keep instructions clear and direct
- put the specific question after large context when relevant

Qwen:

- use model chat templates and provider-supported tool templates
- keep local worker scope bounded and draft-only

DeepSeek:

- use JSON mode for strict JSON
- review thinking/reasoning mode before escalating effort

## Eval Record Shape

The deterministic contract lives in:

- `model-output-evals/model-output-eval-record.schema.json`
- `scripts/validate-model-output-evals.ts`
- `model-output-evals/records/`

`npm run model-output:validate` validates the schema, examples, source-catalog
links, semantic guardrails, and every JSON record under `records/`. The command
is part of `npm run verify`.

Record only bounded, redacted metadata:

- record version
- eval ID
- date created
- project
- task type
- phase
- state
- model or worker
- reasoning profile
- token-efficiency profile
- provider best-practice source IDs
- input packet summary
- output pointer
- score by dimension
- failure labels
- prompt or input delta
- rerun count
- accepted state
- verification evidence
- source pointers
- privacy review
- route review when repeated failures require model/reasoning review
- weekly aggregate pointer when part of batch tuning

Never store secrets, credentials, raw private context, raw project logs,
customer data, raw prompts, raw output, full transcripts, or unredacted remote
records in eval records.

## Definition Of Done

A model-output evaluation pass is done when it records:

- score by dimension
- accepted/retry/route-review/blocked state
- source pointers and verification evidence
- prompt or input delta when rerun
- route-review reason when changing reasoning/model
- weekly aggregate pointer when part of batch tuning
- a passing `npm run model-output:validate` result before the record can inform
  prompt/input tuning
