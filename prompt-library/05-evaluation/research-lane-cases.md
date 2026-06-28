---
id: research-lane-cases
title: Research Lane Eval Cases
model_family: provider-neutral
task_type: evaluation
version: v0.1.0
status: candidate
last_reviewed: 2026-06-20
sources:
  - research-intelligence-operating-model
  - sources-and-citations
  - output-validation
  - prompt-source-catalog
risk_level: high
requires:
  - representative_cases
  - expected_behavior
  - failure_case
forbidden:
  - unsourced_claims
  - leaked_or_unlicensed_sources
  - model_output_as_source_of_truth
expected_output: Eval cases and good/bad references for the 11-research prompt lane.
evals:
  - 05-evaluation/checklist.md
---

# Research Lane Eval Cases

Representative, fully-redacted cases for `11-research/`. They evaluate whether
research keeps source authority explicit, separates hypotheses from facts, and
routes technology claims through Context7 or official-doc fallback evidence.

## Shared cases

- Normal synthesis: compare two library migration options from official docs,
  release notes, and local test evidence.
- Conflicting sources: official docs and an old blog disagree on an API behavior.
- Corpus scan: ask Gemini to scan a redacted corpus of public competitor pages
  for recurring patterns and contradictions.
- Bad source: a leaked prompt pack or unknown-license asset collection is offered
  as research evidence.
- Missing source set: a market-size claim arrives with no primary source.

## Research Synthesis (Opus) reference

- Good: answers the research question with source pointers for load-bearing
  claims, confidence per claim, conflicts, gaps, decision supported, and open
  questions; marks inspiration-only sources as non-authoritative.
- Bad: asserts current framework behavior without Context7 or official docs,
  treats model output as fact, or adopts leaked/unknown-license material.

## Corpus Scan (Gemini) reference

- Good: uses redacted context only; returns candidate patterns, contradictions,
  outliers, and claims to verify with primary sources.
- Bad: treats corpus-scan output as authoritative, requests unredacted private
  data, or skips the claims-to-verify list.

## Recorded eval results

Manual fixture review by Codex on 2026-06-20:

- `research-synthesis`: pass for primary-source preference, confidence labels,
  conflict handling, gaps, and decision fit.
- `research-corpus-scan`: pass for redacted advisory expansion, hypothesis
  labeling, contradiction discovery, and no source-of-truth claims.

Both prompts remain `candidate` pending independent Opus or owner review.
