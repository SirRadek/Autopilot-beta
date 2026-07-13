# Autopilot release-baseline repair and canonical documentation design

## Decision

Before treating Autopilot Beta as an operable Ubuntu VM control plane, repair the audited runtime and state-management blockers, verify the repaired behavior in an isolated VM deployment, and only then publish canonical English documentation from that evidence.

The resulting baseline is a single-user, loopback-first Ubuntu VM service. It is not a public multi-user service and does not add advanced product features such as persistent identities, visual artifact generation, batch or scheduled runs, or automatic multivendor brainstorming.

All canonical documentation will be ordinary Markdown. Every canonical document must be directly reachable through clickable relative links from both the root `README.md` and `docs/README.md`; no canonical document may be orphaned.

## Evidence and source authority

The design is based on the clean merged revision `e6dec33` and four independent read-only reviews:

- architecture and code-path audit;
- Ubuntu VM operations, security, persistence, and recovery audit;
- Cockpit and operator-workflow audit;
- Claude Sonnet 5 advisory audit.

An AGY review traversed the repository but returned only its work narration, not an evidence-backed conclusion. Its output is therefore not accepted as audit evidence. All provider claims remain subordinate to repository code, tests, VM evidence, and owner decisions.

The local Decision Mesh fallback returned no capability match and no immediate capability-selection stop condition. Its broader architect packet was noisy and included unrelated generic nodes; only locally verified Autopilot control-plane, observability, persistence, security, and documentation constraints apply to this work.

## Scope

### Runtime path and persistence repair

- Define `~/projects` as the default canonical root for supervised project worktrees.
- Make the project root explicitly configurable without granting write access to the rest of the user's home directory.
- Require every enabled project registry path to resolve beneath the configured project root.
- Permit the systemd service to write only to the configured project root and the managed state directory.
- Keep the Autopilot installation read-only to its own service.
- Move OpenRouter attempt and spend ledgers beneath the configured Autopilot state directory.
- Provide a fail-closed, one-time migration for legacy OpenRouter ledgers: validate, copy atomically, verify, and retain the legacy source until operator confirmation.
- Add an idempotent registry-initialization command that creates a valid empty registry and project root.
- Require an explicit operator action to register each executable project; discovery on disk never grants execution authority.

### Readiness and provider configuration

- Preserve `GET /health` as a minimal process-liveness endpoint.
- Add a safe readiness surface that checks core configuration, managed-state access and schema, project registry, supervisor, and token gateway.
- Report optional provider failures as component-level `degraded` or `unavailable` states rather than silently succeeding or making the entire core unavailable.
- Keep provider quota probes opt-in, but install and document their configuration explicitly.
- Preserve the provider commands: Codex `/status`, Claude `/usage`, and AGY `/usage`; OpenRouter uses its separately provisioned API credential.
- Make the secure-cookie contract consistent: secure cookies are required behind the documented same-origin TLS proxy and disabled for loopback HTTP development.
- Align the declared Node version, package metadata, CI runtime, systemd prerequisites, and installation instructions on one supported contract.

### Output, incident, and state safety

- Apply one centralized bounded secret-redaction policy before provider output is persisted or exposed through the Control Plane and Cockpit.
- Do not retain a separate unredacted worker-output artifact as part of the normal governed-run path.
- Expand bounded incident capture so failures in status, sessions, workers, providers, observability, background scheduling, and maintenance are not limited to the run router.
- Return correlation identifiers and safe error summaries without exposing credentials, raw prompts, or raw logs.
- Introduce one cross-process state-maintenance lock shared by persistent writers, backup, validation, and rotation.
- Hold the maintenance lock across snapshot creation, immediate validation, and rotation.
- Skip rotation if lock acquisition, backup, or validation fails, and record a bounded incident.
- Treat a backup as a restart-safe snapshot. It may represent a valid intermediate workflow state that the existing reconciliation logic must recover; it is not a general multi-file database transaction.

### Recovery guarantees

- Keep restore offline and validation-first.
- Require the Control Plane to be stopped before applying or cutting over restored state.
- Restore only into an empty staging directory, run readiness and smoke validation there, and then perform an explicit operator cutover.
- Add an automated recovery drill against temporary state. It must never mutate the live VM state directory.
- State the non-guarantees prominently: local backups are not encrypted at rest, are not automatically copied off-host, do not provide zero RPO, and do not replace an operator-owned disaster-recovery policy.

### Canonical documentation

Create or replace the canonical English documentation set:

- `README.md` — current purpose, maturity, supported boundary, quick start, component map, first governed run, and documentation navigation.
- `docs/README.md` — complete clickable documentation index and authority rules.
- `docs/getting-started.md` — first verified Ubuntu VM installation and governed run.
- `docs/user/cockpit-guide.md` — login, sessions, quotas, approvals, runs, outputs, cancellation boundaries, and incidents.
- `docs/architecture/system-overview.md` — components, trust boundaries, data flow, persistence, provider dispatch, Decision Mesh, and MCP boundaries.
- `docs/operations/install-ubuntu-vm.md` — prerequisites, checkout, dependencies, registry bootstrap, secrets, systemd, Cockpit/proxy setup, and acceptance checks.
- `docs/operations/configuration.md` — environment variables, paths, defaults, ports, provider capabilities, secrets, and project allowlisting.
- `docs/operations/service-runbook.md` — deploy, start, stop, restart, status, logs, upgrade, rollback, liveness, readiness, and incident response.
- `docs/operations/state-and-recovery.md` — every managed state file, sensitivity, bounds, retention, migration, backup, restore, drill, and guarantees.
- `docs/operations/troubleshooting.md` — symptom-to-evidence decision paths and safe corrective actions.
- `docs/status/current-status.md` — implemented, repository-tested, VM-verified, runtime-configured, partial, blocked, and planned capabilities.

Historical ADRs remain immutable evidence. Stale architecture, work-log, plan, agent-instruction, and operations pages that compete with the canonical set must either be updated or receive an explicit superseded marker and clickable canonical replacement link. Historical unchecked plan boxes must not be presented as current status.

## Component and data-flow boundaries

The repaired governed path remains:

```text
Cockpit or CLI
  -> loopback Control Plane authentication
  -> project registry and provider readiness
  -> run revision and owner approval
  -> token reservation
  -> durable supervisor task
  -> live Decision Mesh packet and dispatch gates
  -> Codex, Claude, AGY, or OpenRouter worker
  -> bounded central redaction
  -> locked atomic persistence and telemetry
  -> settlement, observability, and Cockpit inspection
```

The writable boundaries are:

```text
~/projects                    supervised project worktrees only
~/.local/state/autopilot     all managed state, outputs, telemetry, and ledgers
```

Credentials remain outside the repository and state backups. The Cockpit remains a same-origin browser client; the Control Plane remains loopback-bound. Public exposure without the documented TLS reverse proxy is unsupported.

## Failure behavior

- Invalid or out-of-root projects fail closed before dispatch.
- Missing optional provider credentials or usage probes are visible as unavailable provider capabilities.
- Core readiness failures return a non-ready status while liveness remains independently observable.
- State lock contention is bounded; timeout does not force or delete another process's lock without verified stale-owner evidence.
- Failed backup or validation prevents rotation.
- Redaction failure prevents persistence of the affected provider output and creates a safe incident.
- Recovery validation failure leaves both live state and staging state unchanged.
- Provider advisory output is never treated as source-of-truth evidence without local verification.

## Verification ladder

### Repository tests

Add targeted tests for:

- project-root acceptance, traversal, symlink, and out-of-root refusal;
- idempotent project-registry initialization;
- OpenRouter ledger placement and legacy migration;
- liveness versus readiness response semantics;
- optional-provider degradation and explicit quota-probe configuration;
- secure-cookie behavior for loopback HTTP and TLS proxy deployment;
- centralized output redaction before file and API exposure;
- incident capture outside the run router;
- state-lock contention, stale ownership, timeout, and release;
- backup validation before rotation and fail-closed maintenance;
- temporary-state recovery drill behavior.

Run targeted tests first, then the repository typecheck, deterministic gates, Cockpit tests/build, browser QA, and full `npm run verify` at the supported Node version.

### Service and VM verification

Validate systemd units statically, then deploy the exact candidate revision to an isolated VM checkout and isolated state directory. Prove:

- the service can write inside one allowlisted project;
- it cannot write outside the configured project root or managed state;
- OpenRouter ledgers are written only inside managed state using a deterministic fake/provider test path that incurs no API spend;
- readiness distinguishes healthy, degraded, and core-failed states;
- provider quota capabilities reflect the configured probes;
- backup, validation, rotation, restore staging, and recovery drill work without touching live state;
- the Cockpit login and governed dry-run workflow pass through the same-origin service boundary.

Live service cutover occurs only after isolated VM evidence passes. Record the revision, commands, state paths, service status, and correlation identifiers.

### Independent review

After implementation and verification:

- run separate architecture, operations/security, and user-workflow reviews;
- request read-only Claude and AGY review with repo-relative evidence requirements;
- reject provider reports that contain only narration, unsupported claims, or no final artifact;
- resolve validated findings and rerun affected checks before documenting completion.

## Documentation acceptance criteria

- English is the only canonical language.
- Every command is copied from a verified supported path and states where it runs: operator host, VM shell, repository root, or Cockpit.
- Every operational claim is labeled as repository-tested, VM-verified, runtime-configured, partial, or planned where ambiguity is possible.
- `README.md` and `docs/README.md` link to every canonical document with valid relative Markdown links.
- Canonical documents link back to the documentation index.
- A deterministic link check rejects broken local documentation links.
- Current limitations are explicit, including single-user auth, non-persistent browser sessions, manual repair packets, unavailable worker cancellation in the Cockpit, absent visual artifact production, and absent batch/scheduled/multivendor orchestration.
- Secrets, absolute private host paths, raw provider output, and raw logs are absent from committed documentation.

## Non-goals

- Persistent multi-user identities, roles, or distributed sessions.
- Public internet exposure without a separate reviewed deployment design.
- Cockpit-integrated documentation; repository Markdown is the approved access surface for this phase.
- Visual artifact generation or preview.
- UI worker-process cancellation.
- Batch, scheduled, dependency-graph, or automatic multivendor runs.
- Autonomous prompt tuning or provider switching.
- Encrypted or off-host backup service.
- Replacing Markdown ADRs or the Decision Mesh with a new source of truth.

## Delivery and rollback

Implementation occurs in a clean worktree based on `origin/main`; the owner's dirty local checkout remains untouched. Changes should be split into reviewable commits by repair package, followed by canonical documentation after VM verification.

Rollback restores the previous service revision and state path. Legacy OpenRouter ledgers remain retained until the operator confirms the migration. No migration may delete its source automatically. Documentation must describe the deployed revision, not merely the newest branch.
