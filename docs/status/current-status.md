# Current status

[Back to the documentation index](../README.md)

Status date: 2026-07-13. Evidence candidate: `5a9ea88982ebca7f62a2aeeae1826ce8aec10c9d`.
This is an isolated release candidate, not a live cutover revision.

Repository verification passed under Node 24 with 100 test files and 912 tests. The same exact commit
passed `npm ci`, typecheck, and the complete deterministic repository gate in the Ubuntu 24.04 VM.
Isolated VM smoke, maintenance, backup validation, recovery drill, readiness, auth, same-origin proxy,
and headless Cockpit login passed without provider calls. The VM also proved that its previous user
systemd manager did not enforce the intended negative-write boundary; commit `5a9ea88` now fails
closed there. Final positive proof under the root system manager awaits the operator's sudo install of
system Node 24 and the reviewed units.

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
| Worker cancellation | CLI path tested | No Cockpit mutation | Exact worker ID and operator CLI | Cockpit shows unavailable | Design server/UI cancellation contract |
| Filesystem service containment | Yes, including fail-closed probe | Negative user-manager case proved | Root system manager + system Node 24 required | Positive deployed-unit proof pending sudo | Install unit and run write proof |
| Batch, scheduled, multivendor automation | No | No | None | Planned only | Separate design and budget gate |

## Release blockers

1. Install Node 24 at the documented system path and install the root-managed units in the VM.
2. Prove the service can write managed state/projects and cannot write its installation.
3. Run the final independent Claude Opus 4.8 review and resolve validated findings.
4. Update this page to the final passing SHA and obtain explicit owner approval before live cutover.

## Accepted warnings

- Product & Design OS fit-safety reports six baseline-matched missing-mobile-breakpoint warnings; the
  gate is green and this release does not claim those source preconditions are visual fit proof.
- Canonical state backups do not include the environment file or provider secrets.
- Provider availability is time-dependent; documentation records capability and configuration, not
  a promise that a particular external model is currently online.
