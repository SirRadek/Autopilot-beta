# Task 7 — final verification report

Date: 2026-07-11
Environment: VM `autopilot-phase0` (`192.168.122.99`), `~/autopilot-beta`

## Full verification

Command:

```bash
export PATH="$HOME/.local/bin:$PATH"
cd ~/autopilot-beta
npm run verify
```

Result: `VERIFY_EXIT=0`.

The final verification stages reported model-output validation with 0 errors and the mesh gate:

```text
total=121 VERIFIED=92 STALE=0 MISSING=21 PLACEHOLDER=8 UNSNAPSHOTTED=0
ratchet: 0 new dead pointer(s) + 0 stale + 0 unsnapshotted (fail if >0); 1 resolved
```

## Quota API state review

The authenticated Control Plane endpoints were exercised with synthetic, non-secret snapshots using the VM's TypeScript runtime. The responses classified all required states:

- `fresh`: `health=healthy`, `freshness=fresh`, `next_poll_at` five minutes after `fetched_at`.
- `stale`: ten-minute-old healthy snapshot returned `freshness=stale` and a non-null `next_poll_at`.
- `unavailable`: `health=unavailable`, `error_code=provider_unavailable`, `freshness=unavailable`, `next_poll_at=null`.

The response also exposed normalized five-hour/weekly windows and `api_spend`; no raw provider payload was returned.

Targeted quota/API tests:

```text
4 test files passed
20 tests passed
```

## Credential and raw-error scan

Command scanned only persisted provider quota artifacts (`provider-quota-snapshots.json` and `provider-quota-events.jsonl`) under the VM state and temporary test directories. The scan checked for API-key patterns, authorization headers, raw response fields, private response text, stack traces, and exception dumps.

Result: `sensitive_scan=clean` (21 quota artifacts inspected).

Quota event persistence intentionally stores only bounded fields (`provider`, `observed_at`, status, changed fields, normalized `error_code`); credentials and raw provider errors are not persisted.

## Conclusion

Task 7 verification passed. No code changes or verification fixes were required.
# Task 7 report: Split run inspector, incidents, and responsive cockpit

## Outcome

- Integrated the governed run composer into a split control-room layout with the run workspace first in DOM order and a collapsible inspector second; narrow CSS keeps that same accessible order while stacking the inspector below the workspace.
- Added a focused run inspector covering all lifecycle states, exact approved revision input, bounded provider output, artifacts, visual-unavailable state, correlated timeline, token/cost/retry evidence, terminal errors, and explicit truncation markers.
- Added a focused incident pane with acknowledgement, bounded repair-packet display, and clipboard copy. Repair packets are labelled manual-only and the cockpit exposes no repair dispatch or execution control.
- Extended route state with a selected run ID and extended cockpit data refresh with parallel, independently failing project/run, incident, and bounded timeline requests.
- Added semantic regions, complementary inspector, tab/tabpanel relationships, roving keyboard focus, Home/End and arrow navigation, and responsive DOM-order coverage.

## TDD evidence

RED:

`npm --prefix cockpit test -- src/features/runs/RunInspector.test.tsx src/features/incidents/IncidentPane.test.tsx src/app/AppShell.test.tsx`

- Failed because `RunInspector` and `IncidentPane` did not exist and the run workspace/inspector regions were absent.
- A follow-up accessibility RED failed because inspector tabs lacked explicit tabpanel relationships.

GREEN:

- Focused feature/layout suite passed 11/11 tests after implementation.
- The accessibility relationship regression passed after adding stable tab IDs, `aria-controls`, and `aria-labelledby`.

## Verification

- `npm --prefix cockpit test`: 13 files, 70 tests passed.
- `npm --prefix cockpit run build`: Vite production build exited 0.
- `npm run typecheck`: root TypeScript check exited 0.
- `git diff --check`: exited 0.

## Environment note

The installed Node.js is 18.19.1 while Vite 7 recommends Node.js 20.19+ or 22.12+. The production build still completes successfully.

## Review hardening

- Removed the unsafe approved-input fallback. The inspector now uses only a revision whose number exactly equals `approved_revision`; missing or inconsistent history produces an explicit alert and never renders `current` as approved evidence.
- Removed global observability from cockpit data. `useRunTimeline` requests only the selected run's exact `worker_run_id`, resets when no correlation exists, and uses generation plus `AbortController` guards so a late prior selection cannot overwrite the current timeline.
- Added a 1,000-character artifact-preview display cap and an explicit per-artifact truncation marker.
- Kept complete server-bounded repair-packet JSON in copy state while independently limiting the rendered preview to 8,000 characters. A near-64 KiB regression proves copied JSON remains complete and parseable.
- Replaced document-global tab lookups and fixed IDs with component refs and `useId`, including two-shell and two-inspector regressions proving focus, headings, and ARIA relationships remain instance-scoped.

Review RED covered all five findings. The focused review suite then passed 22/22 tests.

Fresh review verification:

- `npm --prefix cockpit test`: 13 files, 76 tests passed.
- `npm --prefix cockpit run build`: passed, 42 modules transformed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
