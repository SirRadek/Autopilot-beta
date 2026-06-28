# Agent Handoff Packet

## Handoff ID
HND-2026-06-19-ctx-sharing-observability

## Source Agent
Opus (architecture/governance lane) — handoff + review only, no feature code.

## Target Agent
Codex (implementation lane, workspace-write).

## Project
Autopilot control plane (this repo).

## Mode
WRITE_ALLOWED — but dispatch is PENDING OWNER APPROVAL. Do not start until the owner confirms.

## Goal
Implement a two-layer cross-model context-sharing packet (mode-tagged, source-grounded)
AND its observability layer — deterministic validator, redacted structured logs, and
report-first alerts — so the multi-vendor loop is debuggable and packet-level errors are
caught early. Backed by a real Codex consult on worker-context logic (gpt-5.5, 2026-06-19).

## Scope
1. Policy module: the two-layer model + the named violation taxonomy (data + types).
2. Deterministic validator: pure functions that turn a packet (and a diff step) into a
   list of structured violations. This is the debuggable core.
3. Observability: JSONL event-log schema + a thin append-only sink; report-first alert
   mapping. Redacted per CODEX-HOOK-002 (hashes/classifications/pointers only).
4. Mesh wiring: new `mesh/rules.yaml` rule(s) + regenerate the decision mesh.
5. Tests (vitest) for policy shape + validator behavior (each code triggers and clears).
6. Update the handoff-packet template doc with the two-layer split + mode tag + diff rule.

## Allowed Files Or Surfaces
- `src/data/delivery-system/contextSharing.ts` (NEW) — policy data + types + validator
  (or a sibling `contextSharingValidator.ts`; keep pure functions separate from data if cleaner).
- `src/lib/observability/contextSharingLog.ts` (NEW, create dir) — JSONL event schema +
  append-only sink. Pure schema/types must be unit-testable without touching disk.
- `tests/delivery-system/context-sharing-policy.test.ts` (NEW).
- `mesh/rules.yaml` — add CTX-SHARE rules (see Expected Output).
- `mesh/nodes/observability_mesh.yaml` — extend `signals`/`required_checks` only if needed;
  do not rewrite its objective.
- Regenerated decision-mesh artifact via `npm run mesh:generate` (whatever file it emits).
- `docs/autopilot/agent-handoff-packet-template.md` — additive edits only.

## Forbidden Actions
- No blocking enforcement. Alerts are REPORT-ONLY (CODEX-HOOK-003) until a separate
  owner-approved change with deny tests + rollback.
- No raw content in logs: never persist raw packet text, facts, prompts, transcripts,
  secrets, or supervised-project runtime logs (CODEX-HOOK-002). Hashes + classifications
  + bounded source pointers only.
- No remote mutation, no git commit/push, no new runtime queue or daemon.
- No edits outside the Allowed list. No paid/cloud calls.
- Do not invent a parallel observability system — extend `observability_mesh`.
- If a choice needs an architecture decision (e.g. changing the WANT/SHOULD/IS contract),
  STOP and escalate; do not decide it inside implementation.

## Verified Facts
- Tests run on vitest (`npm run test`); `npm run verify` is the full gauntlet
  (mesh:check, prompt:validate, pdos:validate, diff:check, typecheck, test, build, e2e).
  source: `package.json:7`
- Policies follow `export const X = {...} as const satisfies Interface` and are asserted in
  `tests/delivery-system/*.test.ts`. source: `src/data/delivery-system/modelPolicy.ts`,
  `tests/delivery-system/context-economy-policy.test.ts`
- Decision mesh is generated; `npm run mesh:check` must pass after rule changes.
  source: `package.json:22-23`, `tests/decision-mesh/generated.test.ts`
- Handoff rule already exists: raw agent output is never the next prompt; normalize into
  facts/assumptions/decisions/risks/open-questions/scope/forbidden/checks/output/pointers.
  source: `mesh/rules.yaml:125` (PROTECT-SUP-001), `docs/autopilot/agent-handoff-packet-template.md:53`
- Observability must split control-plane vs project runtime and store redacted summaries
  only. source: `mesh/nodes/observability_mesh.yaml`, `mesh/rules.yaml:77` (OBS-SCOPE-001)
- Codex hooks/guardrails are report-first and store no raw content.
  source: `mesh/rules.yaml:154-171` (CODEX-HOOK-001/002)

## Assumptions
- A "packet" is representable as a typed object with: `mode` (convergent|divergent),
  `pass` (1|2), a fact layer, an interpretation layer, an IS-reference, and lane metadata.
  (verification_needed — confirm against any existing packet type before adding a new one.)
- JSONL on local disk under a gitignored `logs/` path is acceptable for the sink.
  (verification_needed — confirm log location/retention with owner.)

## Decisions Already Made
binding (owner/architecture — apply as constraints):
- Implementation is Codex-only; Opus does not write feature code.
- Alerts report-only first; redacted logs only.
- Extend existing observability mesh, no parallel system.

lead-model (NON-binding — Codex may push back):
- File layout above and the exact violation-code names are a starting proposal.

## Open Questions
- Is there already a packet/handoff TYPE in TS, or only the markdown template? If a type
  exists, extend it instead of creating a new shape.
- Preferred log directory + retention?
- Should the diff-step audit (consensus-trap, compliance-only) ship now, or in a follow-up?

## Risks
- Over-eager validator → false positives that annoy the loop. Mitigation: report-only,
  severities, and tests that pin the clean-packet case to zero violations.
- Scope creep into a runtime queue. Mitigation: pure functions + thin sink only.

## Stop Conditions
- A packet type already exists and the change would fork the source of truth.
- Any requirement to make alerts blocking, store raw content, or mutate remotes.
- `npm run mesh:check` cannot be made green without redesigning a node objective.

## Required Checks (must be green before claiming done)
- `npm run typecheck`
- `npm run test` (new tests pass; existing stay green)
- `npm run mesh:check`
- `npm run prompt:validate` (should be unaffected)
- `npm run diff:check`
- Report results with exact command output; do not claim green without running them.

## Expected Output
### A. Two-layer model (data)
- `alwaysShared` (fact layer): each fact entry REQUIRES `source` (file:line | test id |
  preview-snapshot id | owner-decision id) and a freshness/baseline label. A fact without
  a resolvable source is a violation, not a fact.
- `quarantined` (interpretation layer): lead diagnosis, proposed decomposition, confidence
  ranking, other-model conclusions, taste judgments.
- `decisions`: each entry tagged `origin: owner | architecture | lead_model`; only
  owner/architecture decisions may be `binding` and shared in divergent work.
- `mode`: convergent | divergent. `pass`: 1 | 2.
- IS reference carries `snapshotId` + `timestamp` + `baselineLabel` (never a frozen IS body).

### B. Violation taxonomy (validator output) — codes + severity
| Code | Fires when | Severity |
|---|---|---|
| CTX-FACT-LAUNDER | fact in fact layer lacks a resolvable `source` | blocker |
| CTX-SOURCE-LOSS | `source` present but malformed/unresolvable | major |
| CTX-DECISION-SMUGGLE | `binding` decision whose `origin = lead_model` | blocker |
| CTX-INTERP-LEAK | divergent + pass 1 but interpretation layer non-empty | blocker |
| CTX-MODE-MISSING | packet has no `mode` tag | major |
| CTX-MODE-CONFUSION | mode/lane mismatch (e.g. convergent packet → review lane) | major |
| CTX-BASELINE-SKEW | two lanes in a session reference different IS `snapshotId` | blocker |
| CTX-STALE | IS `timestamp` older than freshness window / baseline changed since emit | major |
| CTX-ACCRETION | packet size over threshold (drifting toward a dump) | major |
| CTX-RAW-SEEPAGE | verbatim-block / transcript markers detected in packet text | major |
| CTX-OVER-REDACT | a field flagged `causally_relevant` was removed by redaction | major |
| CTX-CONSENSUS-TRAP | diff step: all lanes agree AND zero local-verification evidence | major |
| CTX-CHALLENGE-EMPTY | convergent worker returned no challenge-budget entries | minor |
| CTX-COMPLIANCE-ONLY | a packet/live-evidence contradiction was flagged yet worker proceeded | blocker |

Validator API (illustrative, Codex owns final shape):
`validatePacket(packet): Violation[]` and `auditDiff(laneResults): Violation[]` — pure,
deterministic, no I/O.

### C. Observability — log event schema (redacted JSONL)
One line per event. Fields ONLY:
`ts, event(packet_emitted|packet_consumed|violation_detected|diff_recorded|lane_verdict),
handoffId, sessionId, sourceLane, targetLane, mode, pass, factCount, factsWithSource,
quarantinedNonEmpty(bool), isSnapshotId, isSnapshotTs, baselineLabel, packetHash(sha256 of
normalized packet), sizeClass, violations:[{code,severity}], redaction:{applied,fieldsRemoved}`.
No raw text, no secrets, ever (CODEX-HOOK-002).

### D. Alert mapping (report-first)
- blocker/major/minor → emit `violation_detected` log event + a compact console/report
  summary grouped by code. NOTHING blocks dispatch yet (CODEX-HOOK-003).
- Provide a one-call "report" helper that prints the current session's violations as a
  table so the owner can `ladit` (debug) at a glance.

### E. Mesh rule(s) in `mesh/rules.yaml`
- `CTX-SHARE-001` (blocker): "Cross-model context packets are two-layer and source-grounded:
  share facts (with source pointer + freshness label), scope, constraints, allowed/forbidden,
  stop conditions, and baseline label; quarantine lead interpretation; tag every packet with
  a mode." applies_to: [context_economy_policy, protective_supervision_policy, observability_mesh]
- `CTX-SHARE-002` (major): "Divergent tasks run facts-only on pass 1; collect independent
  findings; then run an explicit diff against the lead hypothesis AND live evidence before
  any conclusion." applies_to: [context_economy_policy, protective_supervision_policy]
- Regenerate the mesh; `mesh:check` green.

### F. Doc update
Add to `agent-handoff-packet-template.md`: the two-layer split, the `mode`/`pass` fields,
the `origin` tag on decisions, the IS-identity requirement, and the pass-1/diff rule.

## Evidence And Source Pointers
- Consult transcript summary (this session): Codex flagged fact-laundering as the #1 risk;
  decision split owner/arch vs lead-model; IS needs snapshot identity; convergent workers
  need a challenge budget; stronger pass-1/diff rule.
- Files cited under Verified Facts.

## Progress Impact
Adds the observability + guardrails that make the autopilot context-sharing loop
debuggable. Unblocks safe convergent sharing and protects divergent independence.

## Next Action
1. Owner approves dispatch (or requests Gemini advisory critique of THIS packet first).
2. Codex implements within Scope, runs Required Checks, reports output verbatim.
3. Opus reviews the diff + the validator tests, checks off deficiencies.
