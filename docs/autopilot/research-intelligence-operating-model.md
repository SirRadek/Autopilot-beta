# Research Intelligence Operating Model

Date introduced: 2026-06-19
Status: active control-plane policy
Owner: Autopilot Control Plane

This document defines Autopilot's research layer: technology and library research,
market and competitive research, reference discovery, and research synthesis into
decisions. It extends `prompt-library/00-rules/sources-and-citations.md`, the
research-provider order in the design-intelligence operating model, and the
delivery-system model policy. It is not a separate runtime and is not the source
of truth for provider, pricing, or market facts.

Research produces sourced findings and decisions. Model output is never the
source of truth; current technology and best-practice claims pass the
docs-verification lane before they enter a plan.

## Role Model

Follows the 2026-06-19 role taxonomy: one decision-owner plus supporting roles.

| Model | Research role | Angle | Private data |
| --- | --- | --- | --- |
| Opus (Claude) | research synthesist, decision owner | synthesis to a decision | real data allowed in bounds |
| Gemini | corpus scanner, strategic opponent | large-context option expansion | redacted context only |
| Codex (GPT) | technical verifier | reproduce, check, and test claims | real data allowed in bounds |
| Qwen local | local retriever | private indexing and RAG retrieval | fully private (local) |

### Research Synthesist (Opus)

Runs as the decision-owning synthesist.

Responsibilities:

- frame the research question and the decision it must inform
- gather and weigh sources, preferring official and primary sources
- attach a source and a confidence level to every load-bearing claim
- record conflicts between sources and the gaps that still need verification
- state the decision the research supports and the open questions

Cannot treat model output as fact, adopt unlicensed sources, or approve delivery.

Output:

```yaml
research_packet:
  question: string
  decision_to_inform: string
  findings:
    - claim: string
      source: string
      confidence: low | medium | high
  conflicts: string[]
  gaps: string[]
  decision_supported: string
  open_questions: string[]
```

### Corpus Scanner / Strategic Opponent (Gemini)

Runs as redacted advisory only, using its large context to expand options and
find patterns across a big corpus. Every finding is a hypothesis until verified.
Cannot receive unredacted data or become source of truth.

### Technical Verifier (Codex)

Reproduces and checks claims where possible: runs code, checks versions, confirms
behavior in tests or controlled evidence. Turns "the docs say" into "verified
locally" or "could not reproduce".

### Local Retriever (Qwen local)

Runs fully local for private indexing, embeddings, and RAG retrieval over local
or owner-private material. Never leaves the machine; never final authority.

## Source Classification

Reuse the Source Librarian classification from the design-intelligence operating
model: `approved_source`, `candidate_source`, `inspiration_only`, or `blocked`.
Verify cost, license, commercial-use status, and provenance before a source
becomes implementation input.

## Research Provider Order

1. Context7 for current framework, library, SDK, API, browser, cloud, SEO, and
   accessibility docs when connected.
2. Official documentation and release notes.
3. GitHub repository search for free/open project discovery, activity, license,
   and security review.
4. Hugging Face docs for models, datasets, Spaces, and ML tooling.
5. Local Autopilot architecture library and recorded decisions.

Context7 may be unavailable in a given session; when it is, record the fallback
and use official documentation or another primary source.

## Verification Lane

Technology, library, framework, SDK, API, SEO, accessibility, market-size,
pricing, and best-practice claims are hypotheses until verified through Context7
or a primary source. Stop on `technology_claim_without_context7_or_official_docs`
and `claim_adopted_without_verification`.

## Rubric

| Criterion | Question | Blocker examples |
| --- | --- | --- |
| Sourcing | Does every load-bearing claim have a source? | confident answer with no citation |
| Source quality | Are sources primary and current? | outdated blog as authority |
| License/provenance | Are adopted sources commercially safe? | unlicensed or leaked material |
| Confidence honesty | Are confidence levels and conflicts stated? | uniform certainty, hidden conflicts |
| Decision fit | Does the synthesis answer the actual decision? | interesting facts, no decision |
| Verification | Were tech claims checked, not just quoted? | "docs say" with no reproduction |

## Stop Conditions

- missing research question or decision to inform
- unsourced claim presented as fact
- leaked, unlicensed, or unknown-license source adopted
- technology claim adopted without Context7 or official-docs verification
- real private data routed to a free-cloud model
- model output used as source of truth
- paid source or paid tool required without an owner exception

## Handoff Order

```text
Owner question
  -> Research Synthesist (Opus)         [frame + gather + weigh]
  -> Corpus Scanner (Gemini)            [option expansion, redacted]
  -> Local Retriever (Qwen local)       [private retrieval, as needed]
  -> Technical Verifier (Codex)         [reproduce + verify claims]
  -> Research Synthesist (Opus)         [synthesis -> decision]
  -> Owner                               [decision]
```

## Decision Ledger Entry

```yaml
decision_id: 2026-06-19-research-intelligence-operating-model
type: architecture
context: Autopilot's research work needed a first-class operating model as the focus expands beyond development to design, analysis, research, and business.
decision: Add a Research Intelligence layer with an Opus-led synthesist, a redacted Gemini corpus scanner, a Codex technical verifier, and a local Qwen retriever, reusing the Source Librarian classification and the docs-verification lane.
reasoning: Research needs governed routing, source classification, a provider order, and a verification lane so model output never becomes the source of truth.
alternatives:
  - keep research ad hoc per request
  - trust model output as research authority
  - allow paid research providers by default
impact: Autopilot can route research through typed governance with sourcing, license, and verification gates while preserving subscription-only spend.
approved_by: owner decision on 2026-06-19 to continue formalizing the expanded domains
related_tasks:
  - prompt-library/11-research/research-synthesis.md
  - prompt-library/11-research/corpus-scan.md
```
