# System architecture

[Back to the documentation index](../README.md)

## Purpose and deployment model

Autopilot Beta is a single-operator governance and execution control plane for trusted local CLIs and
an optional OpenRouter API lane. The supported target is one Ubuntu 24.04 VM. The Control Plane binds
to `127.0.0.1`; the Cockpit reaches it directly during loopback development or through a reviewed
same-origin TLS proxy.

## Governed data flow

```text
Cockpit or operator CLI
  -> Control Plane authentication
  -> project registry and readiness
  -> immutable run revision and owner approval
  -> token-gateway reservation
  -> durable supervisor task
  -> Decision Mesh packet and dispatch guards
  -> Codex / Claude / AGY CLI or OpenRouter API
  -> centralized bounded redaction
  -> locked atomic managed-state persistence
  -> token settlement, incidents, observability, and Cockpit inspection
```

The supervisor is the only authority that advances an approved run into dispatch. Provider output is
evidence, not authority. Success requires a locally observed terminal state and persisted result.

## Components

### Cockpit

The React/Vite Cockpit is a thin same-origin client. It renders server state and requests guarded
mutations. It has no direct filesystem, provider credential, or worker-process authority.

### Control Plane

The Node HTTP server owns auth sessions, status routes, session/approval mutations, project and run
routes, provider/readiness views, incident APIs, observability, the quota scheduler, and the supervisor
poll loop. Liveness is deliberately smaller than readiness.

### Project registry and readiness

`projects.json` is an explicit allowlist. Enabled project real paths must remain under the configured
project root. Readiness validates configuration, private state, registry schema, supervisor state,
token state, and optional provider capabilities without repairing or rewriting state.

### Approval and token gateway

Runs retain revisions and bind approval to one exact revision. The token gateway applies per-run,
five-hour, weekly, and provider/spend policy, writes a reservation before dispatch, and records a
bounded lifecycle. Approval never implies unlimited spend.

### Supervisor and dispatch

The durable queue reconciles restart-safe intermediate states and retries only within explicit policy.
Dispatch builds a live Decision Mesh packet and applies routing-mode, model, task-package, access-tier,
sandbox, environment, output, and locking guards before invoking a provider.

### Provider lanes

- `codex_cli`, `claude_cli`, and `agy_cli` are trusted local command capabilities. Their execution
  sandboxes and approval policies are constructed by the worker lane.
- `openrouter_api` accepts only its explicit access tier and credential. Health readers recommend;
  they never switch an in-flight task.
- Quota probes are separate capabilities and do not grant execution authority.

### Persistence and observability

Managed JSON/JSONL files live beneath the state directory. Persistent writers share a cross-process
lease; writes use bounded, no-follow, atomic publication patterns where applicable. Provider output is
sanitized before it reaches a run record, artifact, worker view, or API response. Observability reads
bounded files and emits correlated summaries rather than raw logs.

## Trust boundaries

### Authentication

Admin passwords are verified with asynchronous scrypt against a mode-private,
versioned credential file. Browser cookies are opaque 32-byte HttpOnly tokens;
only SHA-256 digests and generation-bound sliding expiry records persist under
the separate auth state root. Service callers use a separately issued bearer
whose backend also stores only a SHA-256 digest. `CONTROL_PLANE_TOKEN` is retired
and is not an authentication path. There are no roles, distributed sessions, or
public ingress guarantees.

### Filesystem

The persistent service runs as `radek` under the privileged system manager with `ProtectSystem=strict`,
`ProtectHome=read-only`, and explicit writable paths for state, incident spool, and projects. A startup
probe must write both managed roots and must fail to write the installation. The service refuses to
start when the negative write succeeds.

### Project isolation

The project root contains supervised project checkouts only. The Autopilot installation must never be
placed in the project root or added to `ReadWritePaths`. Registry membership and root containment are
both required; either one alone is insufficient.

### Secrets and backups

The environment file and provider credentials stay outside managed state. The
auth state root is explicitly excluded from backup file selection, archive
validation, and restore, preventing old sessions or service digests from being
resurrected. Maintenance skips canonical state snapshots but scans other regular
files in the backup directory for secret-like material and refuses unsafe
rotation. Backups are local and unencrypted; see
[State and recovery](../operations/state-and-recovery.md).

### MCP and skills

The repository Decision Mesh and governed skill catalog provide bounded routing context. MCP discovery
and connected sources do not gain mutation authority merely because they can be read. Any future
write-capable MCP integration requires a separate reviewed capability, owner approval, and audit path.

## Failure model

- Invalid projects, approvals, task packages, access tiers, or token policy fail before dispatch.
- Optional provider failures degrade readiness without hiding core health.
- Lock timeouts never delete an unverified live owner; fixed incidents capture the failure.
- Backup creation and validation complete before rotation. Failure leaves current state unrotated.
- Restore publishes only into an empty staging directory and never overwrites live state automatically.
- Output-policy failure prevents unsafe provider output from becoming normal run evidence.

## Non-goals

The current release does not provide multi-user auth, internet exposure, distributed coordination,
visual artifact rendering, Cockpit worker cancellation, automatic repair, batch/scheduled workflows,
dependency-graph execution, autonomous provider switching, or automatic multivendor brainstorming.
