# Local Worker Operating Model

Date introduced: 2026-05-30
Status: active control-plane policy
Owner: Autopilot Control Plane

This document defines how Autopilot uses local and no-cost workers to reduce paid-token use without lowering review quality.

## Local Machine Baseline

Checked on 2026-05-30:

| Resource | Observed value |
| --- | --- |
| Machine | HP Victus 16-r1xxx |
| CPU | Intel Core i7-14700HX, 20 cores / 28 threads |
| RAM | 32 GB |
| GPU | NVIDIA GeForce RTX 4070 Laptop GPU |
| VRAM | 8 GB |
| Runtime present | Ollama, Node.js, Python, NVIDIA driver tools |
| Ollama models present | `qwen2.5-coder:7b`, `qwen2.5-coder:7b-autopilot` |

`qwen2.5-coder:14b` is the maximum local coding worker target for this machine, not the default. It requires install confirmation and a quick hardware/runtime check before use.

## Worker Lanes

| Worker | Status | Default use | Not allowed for |
| --- | --- | --- | --- |
| Local Search / Index Worker | built in | `rg`, symbol lookup, diff context | semantic guessing, approval |
| Local Static Analysis Worker | built in | typecheck, tests, build, diff check | business or architecture decisions |
| Qwen2.5-Coder 7B Fast Worker | available | small file-local patches, test drafts, bug summaries | broad refactors, approval, security decisions |
| Qwen2.5-Coder 14B Max Worker | install candidate | bounded multi-file repair/refactor drafts | unbounded repo editing, architecture approval |
| Local Summarizer | available | handoff, diff, work-log, and run summaries | source rewrite or factual invention |
| Local Test Runner | built in | targeted checks, full verify, Playwright smoke | approving missing tests |

## Routing Rules

Use deterministic tools first when the task is search, verification, formatting, test execution, or build validation.

Use `qwen2.5-coder:7b` for:

- single-file patch drafts
- small test drafts
- error explanation
- simple implementation alternatives
- local summaries that still cite source context

Use `qwen2.5-coder:14b` only for:

- bounded multi-file repair drafts
- bounded refactor plans
- test strategy drafts
- code-repair alternatives where 7B is too weak

Do not use local LLM workers for:

- architecture approval
- security approval
- business decisions
- public claims
- unbounded autonomous execution
- final delivery approval

## Required Checks

Before using a local LLM worker:

- confirm the model is installed locally
- keep file scope bounded
- keep prompts small and source-grounded
- do not include secrets or credentials
- review every diff or claim
- run deterministic verification before accepting the work
- disclose the model choice when it affects risk or delivery

For Qwen 14B additionally:

- confirm `qwen2.5-coder:14b` is installed
- verify hardware budget and responsiveness
- fall back to Qwen 7B or deterministic tools if the task is small
- escalate to advisory/free-cloud or human review if the task is architectural or security-sensitive

## Stop Conditions

- local model unavailable
- hardware budget unverified
- context too large for local worker
- task requires architecture, security, or business decision
- private secret in prompt
- output used without review
- test failure untriaged

## Current Research Evidence

Official Qwen/Hugging Face records list `Qwen2.5-Coder-14B-Instruct` as Apache-2.0, 14.7B parameters, with long-context support up to 131,072 tokens. The Ollama model library exposes `qwen2.5-coder:14b`, `7b`, `3b`, `1.5b`, and `0.5b` tags. Qwen's own Ollama documentation confirms Ollama is available on Windows and can run Qwen models locally.

Qwen3-Coder-Next is newer and also Apache-2.0, but it is not adopted for this machine in the current policy because the local hardware budget and runtime fit have not been verified. It remains a research candidate, not a worker default.

## MCP Routing

The local read-only MCP server exposes `select_local_worker_route`.

This tool returns a recommended local worker route, required checks, stop conditions, and handoff sequence. It does not run Ollama, install models, mutate files, or approve work.
