# Current status

[Back to the documentation index](../README.md)

Status date: 2026-07-14. Repaired evidence runtime candidate:
`1c83ded12718aad0699a77ac7d16be7e02dbe474`, based on approved candidate
`1b2a35747f81ddf3fa7b06cdb5dcddad36e92d08` merged to `main` by
`89568f6623519dc2bf447ee3b4ea01d2b2679e84`. The repaired candidate must merge before another live
cutover attempt; the live service remains on its previous revision.

Repository verification passed under Node 24 with 100 test files and 912 tests. The same exact runtime
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
| Worker cancellation | CLI path tested | No Cockpit mutation | Exact worker ID and operator CLI | Cockpit shows unavailable | Design server/UI cancellation contract |
| Filesystem service containment | Yes, including fail-closed probe | Positive isolated root-manager proof passed | Root system manager; system Node 24 installed | Persistent unit not installed before cutover | Repeat proof on deployed unit |
| Batch, scheduled, multivendor automation | No | No | None | Planned only | Separate design and budget gate |

## Live cutover gate

The base evidence runtime candidate is merged, system Node 24 is installed, isolated root-manager
containment has passed, independent review findings are resolved, and the owner approved live cutover
on 2026-07-14. Two attempted cutovers rolled back cleanly: the first exposed a runtime-mask assertion
error; the second exposed root-manager `%h` expansion and missing pre-namespace bind targets. Both are
fixed in the repaired candidate, which must merge before cutover resumes.
The cutover must still fail closed unless it:

1. creates and checksum-validates a live-state backup;
2. quiesces every legacy user service and writer before replacing the checkout;
3. retains live revision `390b4e1d0d7f298076a60b2934e5c744d82b30a7` and the prior unit set for rollback;
4. installs the reviewed root-managed units and repeats boundary, liveness, readiness, and deterministic
   no-provider smoke checks; and
5. immediately restores the retained checkout and unit generation if any acceptance check fails.

## Accepted warnings

- Product & Design OS fit-safety reports six baseline-matched missing-mobile-breakpoint warnings; the
  gate is green and this release does not claim those source preconditions are visual fit proof.
- Canonical state backups do not include the environment file or provider secrets.
- Provider availability is time-dependent; documentation records capability and configuration, not
  a promise that a particular external model is currently online.
