# DEV and PROD Cockpit environments

[Back to the documentation index](../README.md)

Autopilot uses one control plane and one Cockpit with an explicit execution profile on each run. DEV
is the iteration environment. PROD is an evidence-gated publication environment. Changing tabs changes
the visible profile; it does not deploy, invoke a worker, or silently change the selected provider,
model, or reasoning effort.

## Phase model

| Phase | Meaning | Worker or publication effect |
|---|---|---|
| DEV Draft | An editable, owner-selected project, route, reasoning effort, prompt, and token estimate. | Preparing a draft invokes no worker. |
| DEV Preview | A completed DEV run whose artifacts and execution evidence can be inspected. | Runs only after the exact draft revision is approved. |
| Promotion pending | A compact packet derived from one completed DEV revision: intent, artifact reference and hash, diff summary, tests, risks, and approvals. | Creates no PROD run and publishes nothing. |
| Approved promotion | The canonical owner approved the packet and full-verification evidence was recorded. | Permits creation of one linked PROD Draft; still invokes no worker. |
| PROD Draft | A draft bound to the approved packet, its source revision, and its full-verification reference. | Requires its own governed approval and execution. |
| Published | A completed linked PROD run has immutable full-verification, release-acceptance, and rollback references. | Read-only evidence state; Cockpit does not auto-deploy it. |
| Rolled back | A published packet records that the existing recovery surface was exercised. | Historical evidence only. |

Existing records without a profile remain readable as `legacy`; they cannot be revised or silently
promoted. A promotion packet is a bounded projection, not a copy of DEV history or raw prompts.

## Promotion invariants

- Only a completed DEV run and its exact revision can create a promotion packet.
- Promotion is explicit and never automatic. The canonical `owner` approval and a non-empty full
  verification reference are required before a linked PROD Draft can be prepared.
- Preparing either DEV or PROD Draft performs no provider invocation. The owner-selected provider,
  model, and reasoning effort remain exact across dispatch and retry; unsupported routes fail closed.
- Publication requires the completed linked PROD run plus full-verification, release-acceptance, and
  rollback evidence. `published` is read-only evidence in the Cockpit and is not a deployment command.
- Efficiency recommendations remain `null` and `shadow_only`. No savings claim is accepted before 20
  ordinary and 5 high-risk work units; otherwise the result is `insufficient_evidence`.

## Verification matrix

| Profile / risk | Required verification | Evidence rule |
|---|---|---|
| DEV ordinary | Node 24 runtime check, typecheck, Decision Mesh changed-files gate, and mapped tests for the changed paths. | Unmapped, mixed, empty, or unsafe paths fall back to the full gate. |
| DEV high-risk | Full fail-closed verification. | High-risk review quality is never reduced by the DEV profile. |
| PROD ordinary or high-risk | Full fail-closed verification, independent review, release acceptance, and rollback proof. | Evidence references must match the approved promotion and linked PROD run. |
| Legacy | Read-only compatibility. | No revise, promote, or dispatch authority is inferred. |

All repository JavaScript and Cockpit builds run on Node `>=24 <25`. Provider availability and
recommendations are advisory evidence only; automatic route, model, reasoning, promotion, publication,
or deployment changes are prohibited.
