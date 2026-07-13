# Phase 8 final whole-branch fix report

Date: 2026-07-13 (Europe/Prague)

## Result

The final governed single-run findings were integrated as one scoped repair wave. Production
Control Plane runtime now owns the persistent supervisor polling loop and uses the real governed
dispatcher. The deterministic smoke uses that same runtime and loop, injecting only its provider
boundary. Governed dispatch accepts caller-owned reservation settlement for this path, leaving one
reservation owner and preserving the existing standalone-dispatch behavior.

Worker exit code, error reason, and lock status are persisted. Nonzero, error-bearing, or failed-lock
results settle actual usage and finalize failed. Provider output is strongly redacted before result
or artifact persistence. Running cancellation remains durable while dispatch is in flight, then
settles actual usage and finalizes cancelled.

Route eligibility is centralized and requires a fresh, available provider and selected model at
prepare, revision, and immediately before approval/reservation. Prompts retain the 32,000-character
storage bound, are conservatively capped below 8,000 estimated model-visible tokens, and require an
explicit cockpit review acknowledgement above 1,000 tokens. The governed packet task is a bounded
run reference instead of a second copy of the full prompt.

## TDD evidence

The initial focused RED run had four expected failures: production runtime did not dispatch,
stale routes prepared successfully, nonzero worker exits completed, and running cancellation
released early. After implementation, the focused Node 24 run passed 67 tests across the run
orchestrator, Control Plane, and deterministic smoke files. Regression fixtures cover deferred
dispatch cancellation, restart-safe persisted results, password/Bearer/API-key redaction, stale
prepare/approve rejection, prompt review/hard caps, production runtime terminal execution, and
single reservation settlement.

## Fresh VM verification

- VM: `autopilot-phase0` (`192.168.122.99`), isolated path
  `/home/radek/autopilot-beta-phase8-final`, Node `v24.18.0`.
- The tree was synced without `.git`, `node_modules`, `.env`, or `test-results`; dependencies were
  installed with `npm ci` and `npm --prefix cockpit ci`.
- `npm run typecheck`: passed.
- Full backend: 85 files, 703 tests passed.
- Full cockpit: 13 files, 78 tests passed.
- Cockpit production build: passed, 42 modules transformed.
- VM browser QA: 7 tests passed in 5.0 seconds, including prepare → approve → terminal evidence.
- Deterministic production-loop smoke: passed with one approval, reservation, supervisor task,
  worker result, artifact, and exactly one `settled` terminal event.
- Fresh VM smoke IDs: run `616d3fc5-1285-4f38-8c39-6210ced58923`, task
  `run-task-8a0380ba-ec44-49e9-b462-9d30b63ab026`, reservation
  `tgr-fd92c179-a968-4786-aef1-593ca5d37a02`.
- Smoke output explicitly reported `provider_invoked: false`; the isolated tree had no `.env`.
- `npm run smoke:cockpit-run -- --live` was rejected with `live_execution_forbidden`, exit 1.
- `git diff --check`: passed.

## Isolation and concerns

The live checkout `/home/radek/autopilot-beta`, its service, and persistent state were never read,
modified, or restarted during this verification. All VM writes were confined to the isolated
feature path and temporary smoke/browser state. No provider credentials were present or loaded.

One prior host-only all-in-one browser run had a transient stale-provider fixture timing miss; its
immediate host rerun passed 7/7, and the authoritative isolated VM run also passed 7/7. No remaining
implementation or verification concern is known.

## Second final-review integration

The follow-up review replaced the unsafe character/4 estimate with a tokenizer-independent UTF-8
byte upper bound. Text tokenizers with byte fallback cannot emit more input tokens than encoded
bytes, so the domain rejects prompts at 9,000 bytes and guarantees fewer than 10,000 model-visible
prompt tokens for ASCII, CJK, emoji, combining sequences, and mixed Unicode. The policy is enforced
in run creation, revision creation, loaded-store validation, and immediately before handoff. The
1,000-byte manual-review acknowledgement is persisted on every immutable `RunDraft`, copied into
its approval record, and checked again when approval is bound.

Runtime startup now calls `SupervisorQueue.recover()` before polling. Cancellation distinguishes a
currently running in-memory task from a recovered persisted orphan: active work drains and settles,
while a recovered queued/failed task cancels and terminalizes instead of looping. Worker-returned
failures now honor `SupervisorQueue.fail()`: a queued retry clears the transient provider result,
keeps the reservation active, persists accumulated attempt usage, and dispatches the exact same
handoff again; only exhaustion settles cumulative usage and finalizes failed. Runtime shutdown is
asynchronous, tracks the active poll, drains it up to a bounded deadline, and only then closes the
server.

Second-wave TDD regressions cover CJK, emoji, combining Unicode, direct non-HTTP bypass, immutable
acknowledgement across revisions, recovered running cancellation, failure-then-success with two
dispatches on one route, retry exhaustion, cumulative settlement, and in-flight shutdown drain.

Fresh host Node 24 verification passed: typecheck; 85 backend files / 710 tests; 13 cockpit files /
78 tests; production build / 42 modules; browser QA 7/7; and deterministic dry-run.

Fresh isolated VM verification at `/home/radek/autopilot-beta-phase8-final` passed the same matrix:

- Node `v24.18.0`, `.env` absent.
- Backend: 85 files, 710 tests passed.
- Cockpit: 13 files, 78 tests passed.
- Build: 42 modules transformed.
- Browser QA: 7/7 passed in 4.7 seconds.
- Dry-run: `provider_invoked: false`, one reservation and one `settled` terminal event.
- Run `bf48c7b6-dc1e-457e-acb6-51ebbfff0d78`; task
  `run-task-d76473fa-b23f-495f-8eb5-5a0ac16ff108`; reservation
  `tgr-744f8b4f-28b9-494b-9d4a-280bd86a7a17`.
- `--live`: rejected with `live_execution_forbidden`, exit 1.

The live VM checkout, service, persistent state, credentials, and providers were not touched.

## Final token-gate review

Client `estimated_tokens` is no longer an authority. The governed domain computes one canonical
approved budget as conservative UTF-8 prompt bytes plus a fixed 64-token output allowance. A
missing HTTP estimate uses that canonical value; an explicit zero or underestimate is rejected;
an overestimate is ignored and only the canonical value is persisted. Creation, revision, loaded
state, approval, handoff, and reservation binding all recheck the canonical value. The reservation
input is the conservative prompt bound, output is exactly the bounded allowance, and reservation
total must equal the immutable approved draft budget.

`TokenGateway.settle` now validates without mutation that actual input plus output does not exceed
the reservation total and rechecks provider, model, and session route caps. Cumulative retry usage
shares the same immutable reservation; a retry that would exhaust it is cancelled, released, and
terminalized with `token_settlement_exceeds_reservation` instead of obtaining unapproved growth.
Cockpit types now expose worker `exitCode`, `errorReason`, and `lockStatus`, plus cumulative retry
input/output token fields, with fixture coverage.

Final TDD coverage includes direct-domain and HTTP zero/underestimate rejection, canonical
persistence, reservation-total equality, atomic settlement overrun, provider/model/session near-cap
behavior, cumulative retry exhaustion, and cockpit metadata/accounting types. The existing bounded
token-ledger stress test received an explicit 15-second timeout because its 1,612 durable writes can
exceed Vitest's 5-second default on the VM; it completed in 4.3 seconds on the final run.

Fresh host Node 24 verification passed: typecheck; 85 backend files / 715 tests; 13 cockpit files /
79 tests; build / 42 modules; browser QA 7/7; deterministic dry-run.

Fresh isolated VM verification passed:

- Node `v24.18.0`, isolated `/home/radek/autopilot-beta-phase8-final`, `.env` absent.
- Backend: 85 files, 715 tests passed.
- Cockpit: 13 files, 79 tests passed.
- Build: 42 modules transformed.
- Browser QA: 7/7 passed in 4.6 seconds.
- Dry-run: `provider_invoked: false`, one reservation and one `settled` terminal event.
- Run `2405e2d6-f33f-4e0f-bdcb-9885d38a96b9`; task
  `run-task-69107a71-7a8e-4654-b972-fa39b6a2d01c`; reservation
  `tgr-fbd02107-c6b6-4ce2-ba9d-d5a5f5519832`.
- `--live`: rejected with `live_execution_forbidden`, exit 1.

The live checkout, service, persistent state, credentials, and providers were not touched.

## Final output-allowance and wire-contract review

The approved governance envelope now persists three separate immutable values on every draft and
approval revision: the conservative UTF-8 `input_token_bound`, an 8,192-unit
`output_token_allowance`, and their exact canonical `estimated_tokens` total. The allowance has an
explicit 16,000 hard maximum aligned with the gateway's session/output ceiling. Clients can neither
raise the allowance nor replace the canonical total: explicit underestimates are rejected and
larger estimates are normalized. Loaded state missing or altering either component fails validation;
there is no migration default for these new authority fields.

Reservation uses the two approved components directly. Settlement rejects cumulative retry output
above the allowance or cumulative input plus output above the total. Tests prove a realistic
multi-KiB result succeeds, exactly 8,192 output bytes succeeds, 8,193 fails, and failure-then-success
usage accumulates under one reservation. Existing gateway tests cover atomic overrun rejection and
provider/model/session exhaustion. The deterministic smoke now returns a representative 2,048-byte
payload after its result header.

Cockpit `RunProviderResult` now matches Control Plane JSON exactly with `exit_code`, `error_reason`,
and `lock_status`; the typed inspector and browser fixtures exercise those wire names, the separate
budget fields, and cumulative retry accounting.

Fresh host Node 24 verification passed: typecheck; 85 backend files / 716 tests; 13 cockpit files /
79 tests; production build / 42 modules; browser QA 7/7; representative dry-run; guarded live-mode
rejection.

Fresh isolated VM verification at `/home/radek/autopilot-beta-phase8-final` passed the same matrix:

- Node `v24.18.0`, `.env` absent.
- Backend: 85 files, 716 tests passed.
- Cockpit: 13 files, 79 tests passed.
- Build: 42 modules transformed.
- Browser QA: 7/7 passed on the confirming run (the first run exposed the known stale-provider
  timing flake; the immediate isolated rerun passed 7/7 without code or state changes).
- Dry-run: `provider_invoked: false`, 2,083-byte artifact preview, one reservation, one `settled`
  terminal event.
- Run `a53483c5-beab-4804-97d2-ed1f6719016f`; task
  `run-task-069bd587-bd9a-49fb-8e42-dd100a31ed5a`; reservation
  `tgr-1a333c2f-f895-4658-892a-f120456b3d59`.
- `--live`: rejected with `live_execution_requires_explicit_provider_authorization`, non-zero exit.

The live checkout, service, persistent state, credentials, and providers were not touched.
