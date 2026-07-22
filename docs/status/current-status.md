# Current status

[Back to the documentation index](../README.md)

Status date: 2026-07-14. Deployed runtime revision:
`0ee4ae2143d7be0465708a1cd8b6a0ffd217190c`, the merge commit for the repaired
root-systemd candidate. The live VM now runs the privileged system-manager unit as `User=radek`; the
legacy user units are disabled, inactive, and runtime-masked.

Repository verification passed under Node 24 with 100 test files and 914 tests. The same exact runtime
candidate passed the complete deterministic repository gate in the Ubuntu 24.04 VM. Its isolated
root-systemd acceptance proved a read-only installation, the two managed writable roots, and a managed
private runtime temporary directory while preserving access to host tmux sockets. A repeated proof on
the repaired candidate also proved explicit system-manager home paths and tmpfiles provisioning before
namespace construction. Liveness, core
readiness, provider-unavailable reporting, and deterministic Cockpit smoke passed without provider
invocation; the alternate acceptance service was then stopped. Earlier isolated acceptance also passed
maintenance, backup validation, recovery drill, auth, same-origin proxy, headless Cockpit login, host
Cockpit tests/build, and all seven Playwright scenarios. The full release baseline received an independent
read-only `claude-opus-4-8` review with no actionable findings, and the final runtime-temp delta received
an independent code review with its systemd regression finding resolved before merge.

| Capability | Repository-tested | VM-verified | Runtime configuration | Limitations | Next step |
|---|---|---|---|---|---|
| Project registry/root containment | Yes | Yes | State and project root | Manual registration | Add governed registration UI |
| Liveness and core readiness | Yes | Yes | Token, paths, optional probes | Providers may be unavailable | Monitor deployed unit |
| Browser auth and CSRF boundary | Yes | Yes | Shared token; Secure cookie behind TLS | Single user; sessions process-local | Production proxy acceptance |
| Prepare/revise/approve run | Yes | Dry-run and browser QA | Registered project and fresh route | One run at a time in current UX | Live no-cost provider trial |
| Token reservation/settlement | Yes | Yes | Budget policy and provider evidence | Budgets remain operator-tuned | Calibrate from telemetry |
| Durable supervisor loop | Yes | Yes | Persistent state | No batch/dependency scheduling | Add bounded workflow graph later |
| Codex/Claude/AGY dispatch | Yes | Earlier live smoke evidence; not called in this acceptance | Authenticated trusted CLIs | Provider behavior remains external | Per-provider acceptance after cutover |
| OpenRouter dispatch | Yes | Earlier governed smoke evidence; no credits used now | `OPENROUTER_API_KEY` | API cost and model availability vary | Configure secret and budget explicitly |
| Quotas, models, API spend | Yes | Degraded/unavailable path verified | Active-session probes; OpenRouter credential | Provider windows may be absent | Enable one provider at a time |
| Output redaction and bounded details | Yes | Deterministic smoke | Central output policy | Text artifacts only | Design visual artifact pipeline |
| Operational incidents | Yes | Route/state paths exercised | Persistent incident store and spool | Repair packets are manual | Add repair workflow audit UX |
| State maintenance and backup | Yes | Yes | Daily timer; private env/state | Local, unencrypted, non-zero-RPO | Add off-host operator policy |
| Recovery drill | Yes | Yes | Valid `.apbackup.json` | No automatic live cutover | Schedule periodic evidence |
| Cockpit responsive/browser QA | Yes | Yes | Chromium dependencies | Partial Czech UI; not full AT certification | Product/design review |
| DEV/PROD Cockpit environments and promotion | Yes | Pending final VM regression acceptance | Explicit run profile; owner-approved promotion packet; immutable evidence refs | Publication remains read-only and evidence-gated; no automatic deploy | Complete unchanged proxy/recovery acceptance |
| Worker cancellation | CLI path tested | No Cockpit mutation | Exact worker ID and operator CLI | Cockpit shows unavailable | Design server/UI cancellation contract |
| Filesystem service containment | Yes, including fail-closed probe | Deployed root-manager proof passed | Root system manager; system Node 24; tmpfiles prerequisites | Requires explicit writable-root review for path changes | Monitor unit and timers |
| Batch, scheduled, multivendor automation | No | No | None | Planned only | Separate design and budget gate |
| Brainstorm mode (multi-provider fan-out/consolidation/arbitration) | Yes | No | Governed run orchestrator; atomic orchestration groups; DEV-only mutation | PROD is read-only; efficiency remains `insufficient_evidence` until 20 ordinary + 5 high-risk samples | VM acceptance and live provider trial |

## Live cutover result

The owner-approved cutover completed on 2026-07-14 after two earlier attempts rolled back cleanly.
Revision `0ee4ae2143d7be0465708a1cd8b6a0ffd217190c` is deployed from a clean checkout. Post-cutover
verification confirmed:

1. root-managed service and health/maintenance timers are active and enabled;
2. boundary proof, liveness, core readiness, and deterministic Cockpit smoke pass with no provider call;
3. every installed unit and the tmpfiles definition byte-match the deployed revision;
4. the fresh validated backup is
   `/home/radek/.local/state/autopilot/backups/autopilot-state-2026-07-14T13-43-35-564Z.apbackup.json`;
5. prior revision `390b4e1d0d7f298076a60b2934e5c744d82b30a7`, including its 87 local changes, is retained at
   `/home/radek/autopilot-beta.rollback-20260714T134335Z`; and
6. the legacy user units are inactive and runtime-masked, with exactly one listener on port `8787` and
   no listener on isolated port `8877`.

### Reboot drill

A graceful VM reboot on 2026-07-14 changed the boot ID and returned without manual service recovery.
The deployed checkout remained clean at the same revision; the root service and both timers returned
active and enabled with zero service restarts. The health timer fired after boot, while all three legacy
user entry units remained inactive and disabled after their runtime masks expired. Startup repeated the
positive filesystem-boundary proof, and liveness, core readiness, backup validation, and deterministic
Cockpit smoke passed again with `provider_invoked=false`.

The pre-reboot recovery point is
`/home/radek/.local/state/autopilot/backups/autopilot-state-2026-07-14T13-53-08-708Z.apbackup.json`
(`5` files, `4457` bytes); its recovery drill returned ready and reconciled. Keep the retained rollback
checkout until the production proxy acceptance is complete.

## Accepted warnings

- Product & Design OS fit-safety reports six baseline-matched missing-mobile-breakpoint warnings; the
  gate is green and this release does not claim those source preconditions are visual fit proof.
- Canonical state backups do not include the environment file or provider secrets.
- Provider availability is time-dependent; documentation records capability and configuration, not
  a promise that a particular external model is currently online.
