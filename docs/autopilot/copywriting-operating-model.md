# Copywriting Operating Model

Date introduced: 2026-06-19
Status: active control-plane policy
Owner: Autopilot Control Plane

This document defines Autopilot's copy layer: UI copy and microcopy, technical
documentation and terminology, brand voice, and localization. It extends the
existing `copywriting` role layer in `src/data/delivery-system/roles.ts` and the
Copywriting row in the delivery-system model policy. It is not feature code and
is not the source of truth for product, factual, legal, or pricing claims.

Copy produces language, not approvals. The owner approves product and factual
claims; copy work never approves delivery or mutates remote services.

## Role Model

Maps the existing copywriting roles to models per the 2026-06-19 taxonomy.

| Role (roles.ts) | Model | Function | Private data |
| --- | --- | --- | --- |
| Copywriter | Opus (Claude) | primary UI copy, microcopy, clarity, decision owner | real data allowed in bounds |
| Technical Writer | Opus (Claude), Codex for accuracy | docs, terminology, consistency | real data allowed in bounds |
| Brand Voice Reviewer | Gemini (advisory) + owner (gate) | tone consistency, anti-cliche, conversion angle | redacted context only |
| Localization Reviewer | owner / Opus (gate); Qwen drafts | translation quality, accessibility language | local for private content |

### Copywriter (Opus)

Runs as the decision-owning writer.

Responsibilities:

- write UI copy, microcopy, headlines, and body in the brand voice
- keep reading level and accessibility language appropriate to the audience
- mark every product, factual, legal, or pricing claim for owner verification
- synthesize variant and review feedback into the final copy

Cannot approve product claims, approve delivery, or treat model output as fact.

Output:

```yaml
copy_packet:
  surface: string
  audience: string
  brand_voice: string
  copy: string
  claims_to_verify: string[]
  reading_level: string
  open_questions: string[]
```

### Technical Writer (Opus, Codex for accuracy)

Writes technical docs and maintains terminology. Codex confirms technical
accuracy against the code and tests. Does not approve its own output.

### Brand Voice Reviewer (Gemini advisory + owner gate)

Runs as redacted advisory. Generates divergent tone and headline variants, checks
brand-voice consistency, anti-cliche, and conversion logic. The owner holds the
approval gate. Cannot receive unredacted private data or approve work.

### Localization (Qwen local drafts, owner/Opus review)

Qwen drafts translations locally for private or bulk content and checks
terminology consistency and accessibility language across locales. Drafts only;
the Localization Reviewer gate stays with the owner or Opus.

## Claims Gate

Any product, factual, legal, or pricing claim in copy is a hypothesis until
verified through `prompt-library/00-rules/sources-and-citations.md` and the
docs-verification lane, and the owner approves product claims. Overclaiming is a
stop condition.

## Data Privacy Axis

Real customer names, private content, and account data may be handled by Opus and
Codex (owner subscriptions) or by Qwen locally. Gemini receives a redacted brief
only. Localization of private content stays local.

## Rubric

| Criterion | Question | Blocker examples |
| --- | --- | --- |
| Clarity | Is the message understood on first read? | jargon, ambiguous CTA |
| Brand voice | Does tone match the brand and audience? | off-voice, generic AI tone |
| No overclaiming | Are claims accurate and verifiable? | unverifiable superlatives |
| Accessibility | Is reading level and language inclusive? | dense legalese in UI copy |
| Conversion | Does copy support the user's next action? | CTA that hides the action |
| Consistency | Is terminology consistent across surfaces? | three names for one feature |
| Localization | Are translations accurate and natural? | literal machine translation |

## Stop Conditions

- missing surface, audience, or brand voice
- product, factual, legal, or pricing claim adopted without verification
- real private data routed to a free-cloud model
- model output used as source of truth
- the writer approving its own copy as final
- delivery or remote mutation requested from this layer

## Handoff Order

```text
Owner intent
  -> Copywriter (Opus)                 [primary copy + claims flagged]
  -> Brand Voice Reviewer (Gemini)     [tone + variants, redacted]
  -> Localization (Qwen local)         [translation drafts, as needed]
  -> Copywriter (Opus)                 [synthesis -> final copy]
  -> Owner                              [claim + delivery approval]
```

## Decision Ledger Entry

```yaml
decision_id: 2026-06-19-copywriting-operating-model
type: architecture
context: Copywriting was the last model-policy layer without a prompt lane or operating model after the business, design, analysis, and research layers were formalized.
decision: Add a Copywriting operating model mapping the existing copywriting roles to models (Opus copywriter/technical writer, Gemini brand-voice reviewer, Qwen localization drafts), with a claims gate, the data-privacy axis, and an 12-copywriting prompt lane.
reasoning: Copy needs governed routing, a claims-verification gate so the model never overclaims, and a privacy axis for private localization content.
alternatives:
  - keep copy ad hoc per request
  - let a single model own all copy and approvals
  - allow free-cloud models to handle unredacted private copy
impact: All model-policy layers up to copywriting now have governance parity while preserving subscription-only spend and owner approval of product claims.
approved_by: owner decision on 2026-06-19 to complete the copywriting lane
related_tasks:
  - prompt-library/12-copywriting/copywriting.md
  - prompt-library/12-copywriting/voice-variants.md
  - prompt-library/12-copywriting/localization.md
```
