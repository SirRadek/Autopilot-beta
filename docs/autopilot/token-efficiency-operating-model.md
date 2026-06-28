# Token Efficiency Operating Model

Date introduced: 2026-05-30
Status: active control-plane policy
Owner: Autopilot Control Plane

This document defines how Autopilot avoids wasting paid tokens while keeping work reviewable.

## Caveman Mode

Caveman Mode is the cheapest useful route for narrow work. It is not lower quality; it is stricter about scope.

Use it for:

- known-file fixes
- small patches
- test failure triage
- simple local explanations
- routine local work

Rules:

- one task only
- read only the required files
- use `rg` before opening files
- prefer diff, failing command output, and line references over full files
- use deterministic tools before LLMs
- use local/no-cost workers before cloud reasoning
- stop instead of guessing
- answer briefly unless risk requires detail

Default worker order:

1. deterministic tools
2. local search/index
3. Qwen2.5-Coder 7B fast worker
4. Qwen2.5-Coder 14B max worker only when installed and justified
5. free-cloud advisory only when local evidence is blocked or independent critique adds value

## Compact Profiles

| Profile | Budget | Use for | Escalation |
| --- | --- | --- | --- |
| Caveman | tiny | small patches, known files, triage | architecture/security decision, repeated failure |
| Standard Compact | small | bounded features, docs, policy updates | ambiguous requirements, cross-module contracts |
| Review Compact | medium | code, architecture, security, governance review | conflicting evidence, public API/auth/payment/security |
| Research Compact | medium | current docs, GitHub discovery, technology comparison | unknown license, unknown cost, runtime-scope change |

## Stop Conditions

- full repository dump requested without reason
- context too large for Caveman Mode
- task requires architecture, security, business, or delivery approval
- paid model or credits required
- private data not redacted
- model output used without review
- repeated local worker failure

## MCP Routing

The local read-only MCP server exposes `select_token_efficiency_route`.

This tool returns the Caveman or compact profile, context rules, first moves, worker order, output rules, escalation rules, and stop conditions. It does not run models, mutate files, install dependencies, or approve work.
