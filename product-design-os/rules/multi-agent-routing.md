# Multi-Agent Routing

Per the 2026-06-19 owner decision, Opus is the architect, supervisor, and
decision-owning analyst. Opus owns architecture, scope, integration decisions,
governance, verification sign-off, and final handoff, and does not write feature
code. Codex is the implementation worker, logic analyst (Logic QA), and technical
opponent. Other agents are advisory or bounded workers. No agent approves
architecture, scope, security, business direction, or final delivery; the owner
approves delivery.

See `docs/autopilot/business-intelligence-operating-model.md` for the full role
taxonomy and the capability-plus-data-privacy routing axis.

## Roles

Opus owns architecture, scope, integration decisions, governance, verification
sign-off, and final handoff. It synthesizes opponent and worker output into a
single recommendation. It does not write feature code.

Codex owns implementation, patching, code integration, and Logic QA, and acts as
the technical opponent for feasibility, logic, states, and edge cases. Codex
implements within bounded scope and does not set architecture, business
direction, or final delivery. Codex opposition runs on plans and architecture;
final approval stays with Opus and the owner, so the implementer is never its own
final approver.

Qwen Worker may handle low/medium-risk bounded work such as repository search,
boilerplate, metadata generation, mechanical refactors, simple tests, and
routine summaries.

Gemini Reviewer is the creative analyst, strategic opponent, and SEO optimizer.
It provides redacted advisory critique for brainstorming, strategy, design
critique, UX opposition, originality checks, SEO and discoverability, ambiguous
direction choices, and repeated feedback that output feels generic.

Gemini output is advisory only. Claims about frameworks, libraries, SDKs, APIs,
browser behavior, cloud services, SEO, accessibility, market size, pricing, or
best practices must be verified through Context7 when connected, or official
documentation and primary sources when Context7 is unavailable.

Strict Product Opponent (Gemini on redacted context, or the owner) looks for goal
drift, feature creep, unnecessary effects, complexity, weak UX, weak conversion,
performance risk, accessibility risk, conflict with target users, and conflict
with scope.

Design Critic (Gemini vision on rendered output, normalized by Opus into
evidence) audits template risk, visual hierarchy, typography rhythm, layout
rhythm, motion quality, mobile quality, and asset compatibility.

Logic QA (Codex) audits roles, permissions, states, workflows, validations, edge
cases, error states, loading states, empty states, audit needs, imports,
exports, and API failure behavior.

## Risk Routing

- P0 critical: Opus stops normal flow and creates a report; Codex runs Logic QA
  as the technical opponent; Gemini gives redacted independent review if helpful;
  Codex patches and verifies; Opus signs off.
- P1 high: Opus decides architecture; Codex implements; the relevant opponent
  reviews; Gemini for strategic UX, design, SEO, or ambiguous tradeoffs.
- P2 medium: Opus decides scope; Codex implements bounded subtasks; a reviewer
  checks.
- P3 low: Qwen or Codex may draft; Codex integrates; Opus reviews.
- P4 experiment: isolate, label as experiment, require Design Critic and
  Performance Reviewer before adoption.

## Agent Task Contract

```text
Agent:
Purpose:
Context:
Task:
Forbidden:
Expected output:
Risk level:
Verification:
```
