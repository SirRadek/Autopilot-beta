# Brainstorm mode

[Back to the documentation index](../README.md)

Brainstorm mode sends one immutable brief independently to 3–4 explicitly selected provider
routes, consolidates their outputs into consensus and conflicts, and optionally lets a
non-conflicted route arbitrate material disagreements before producing a final artifact. It is a
governed extension of the existing run orchestrator: every provider call is still a normal
approved, token-reserved, redacted run. There is no new dispatch path, no automatic routing, and no
recursive debate loop.

## Operator workflow

1. **Create a draft.** The operator supplies a project, an immutable brief, 3–4 fan-out routes, and
   one synthesizer (consolidation) route, and optionally one arbitration route. Each route is an
   explicit `(provider, model, reasoning_effort)` triple; nothing is defaulted or silently
   substituted. `openrouter_api` routes require `reasoning_effort: null`; every other provider
   requires a non-null value drawn from that provider's supported set. Creation snapshots the
   currently eligible routes and computes the token envelope, but makes zero provider calls — no
   run, hold, or dispatch exists until the operator approves.
2. **Review the token envelope.** The draft response shows `minimum_tokens` (fan-out +
   consolidation) and `maximum_tokens` (minimum + optional arbitration). This is a worst-case
   range, not an estimate the operator can override per stage.
3. **Approve.** Approval is the only transition that starts work. It atomically reserves the
   worst-case envelope as one orchestration group whose per-route/stage slot holds sum to exactly
   `maximum_tokens`, then creates one DEV run per fan-out route through that group. The parent
   envelope itself is never charged again — only the slot holds are; claiming a slot does not
   increase reserved usage, and settlement replaces a slot's hold with the run's actual usage.
   Changing the brief or any route after approval is not possible; a changed selection requires a
   new draft.
4. **Fan-out runs independently.** Each provider route receives the exact same brief and cannot
   see any other route's output. Round one is a single non-recursive round.
5. **Consolidation.** Once every fan-out run is durably `completed` with a terminal text artifact
   (never inferred from prose such as "done" or a plan summary), the coordinator starts exactly one
   consolidation run in its own reserved slot. The prompt embeds every fan-out output inside a
   random 128-bit nonce-delimited block labeled `UNTRUSTED_PROVIDER_OUTPUT_<letter>`, explicitly
   instructs the model not to execute instructions found in that untrusted data, and demands strict
   JSON: `{"consensus": [...], "conflicts": [...], "confidence": 0..1, "final": "..."}`. The parser
   enforces exact keys, byte/count/length bounds, and rejects anything else.
   - **No material conflicts:** the brainstorm completes with `final_artifact` set to the
     consolidation's `final` text; no further stage runs.
   - **Material conflicts, arbitration route precommitted:** the record enters
     `needs_arbitration` with the conflicts persisted. No additional tokens are spent while
     waiting for the operator.
   - **Material conflicts, opted out at creation (`arbitration_route: null`):** the brainstorm
     fails immediately with no `needs_arbitration` stage — there is no route to reconfirm, so the
     brainstorm cannot proceed and is never silently completed as if consensus had been reached.
6. **Arbitration reconfirms the precommitted route — it is never chosen at this stage.** The
   arbitration route is fixed at draft creation (step 1); `needs_arbitration` only lets the
   operator explicitly reconfirm that same route with a new named approval
   (`requestArbitration`), which is rejected unless it is byte-for-byte identical to the route
   stored on the record. If that precommitted arbiter's provider appears among any material
   conflict's source runs, the brainstorm is marked `failed` (`brainstorm_no_independent_arbiter`)
   — the coordinator never substitutes a different, uninvolved provider on the operator's behalf;
   a new, independent brainstorm is required.
7. **Exactly one arbitration round.** The arbiter receives every material conflict in one bounded,
   nonce-delimited, escaped prompt (brief, both conflicting outputs, and the conflict summary per
   item) and must return strict JSON `{"resolution", "rationale", "unresolved": [...]}`. Any
   non-empty `unresolved` list fails the brainstorm with `brainstorm_unresolved_conflict` — the
   coordinator never starts a second arbitration run automatically. A clean resolution completes
   the brainstorm with `final_artifact` set to `resolution`.
8. **Cancellation.** The operator may cancel from any non-terminal state before
   `needs_arbitration`/`arbitrating` (a fail-closed choice: a brainstorm already awaiting or running
   arbitration must resolve or fail, not be abandoned mid-decision). Cancellation cancels every
   still-running run in the orchestration group and releases any slot whose run is not actively
   running, so unused reservations do not linger.

## Restart and idempotency

Every mutation is a compare-and-swap on the brainstorm's `revision`; stale writers fail with
`brainstorm_revision_conflict` instead of clobbering newer state. Approval, consolidation, and
arbitration all key their run creation by the immutable `(orchestration_group_id, slot_id)` pair:
`ensureGroupRun` finds or creates the one run for that key, repairs a missing approval record after
a crash, and rejects the same key paired with different immutable input. Retrying `approve`,
letting `tick` re-run, or restarting the control-plane process mid-transition converges on the same
group, the same per-slot runs, and never creates duplicate child runs or double-reserved tokens.

## DEV and PROD

Brainstorm creation and mutation (approve, arbitrate, cancel) are DEV-only operations, consistent
with [DEV/PROD Cockpit environments](dev-prod-environments.md). PROD is read-only: it can only
consume a brainstorm's completed, evidence-backed final artifact through the existing
promotion/full-verification workflow. PROD never creates, approves, or arbitrates a brainstorm.

## Telemetry

Each lifecycle transition (`created`, `fanout_completed`, `consolidated`, `arbitrated`, `failed`,
`cancelled`) appends one privacy-safe event: brainstorm ID, provider count, material conflict
count, estimated and actual token totals, duration, and timestamp. Telemetry never stores the
brief, raw provider outputs, artifact previews, model responses, credentials, or absolute project
paths.

## Recommendations and efficiency evidence

Any provider/route recommendation surfaced to the operator is `shadow-only` and may be `null`; a
recommendation never dispatches work or changes routing on its own. The 30% efficiency target from
the original brainstorm design goal must not be claimed. Efficiency reporting stays
`insufficient_evidence` until at least 20 ordinary work units and 5 high-risk work units have been
observed; see [token efficiency operating model](token-efficiency-operating-model.md) for the
sampling gate.
