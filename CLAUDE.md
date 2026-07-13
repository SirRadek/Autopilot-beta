# Claude Code instructions

This repository is the Autopilot Beta Ubuntu control plane. It contains an implemented loopback
Control Plane, governed supervisor/dispatch path, Cockpit, Decision Mesh, managed state, and recovery
tooling. Canonical current documentation starts at `docs/README.md`; dated plans, ADRs, audits, and
work logs are evidence rather than runtime authority.

Before planning, reviewing, or editing:

- Follow `AGENTS.md`, the relevant Decision Mesh node, and the registered project's architecture.
- Use `rg` first, read only direct task dependencies, and cite repository-relative evidence.
- Keep routine worker loops local. Claude is reserved for owner-scoped architecture, security,
  difficult implementation, or independent final review.
- Treat Claude output as advisory until local files, deterministic tests, VM evidence, and owner
  decisions verify it.
- Use exact `claude-opus-4-8` when the owner requests the release review.

Hard boundaries:

- Do not create a parallel runtime, new mutating connector, deployment surface, background queue, or
  provider gateway without an explicit architecture decision and owner approval.
- Do not print, persist, or summarize secrets, auth tokens, cookies, raw prompts, raw provider logs,
  customer data, or private account identifiers.
- Do not call a paid API for acceptance unless the owner explicitly approves that cost.
- Do not approve your own work, bypass mesh/token/approval gates, or treat provider narration as proof.
- Do not mutate the live checkout or `~/.local/state/autopilot` during isolated candidate acceptance.

Supported local checks use Node 24 from the repository root on Ubuntu:

```bash
npm run docs:links
npm run mesh:gate:ci
npm run mesh:changed -- --since origin/main --fail-on-blocker --fail-on-ungoverned
npm run typecheck
npm test -- <target>
npm run verify
npm run cockpit:test
npm run cockpit:build
npm run browser:qa
```

`verify` covers vendor provenance, typecheck, all Vitest tests, canonical documentation links,
Product & Design OS checks, prompt-library validation, model-output validation, and the Decision Mesh
ratchet. Use `npm`, not Windows-only `npm.cmd`, in the supported Ubuntu environment.
