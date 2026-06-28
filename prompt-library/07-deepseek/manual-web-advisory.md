---
id: deepseek-manual-web-advisory
title: DeepSeek Manual Web Advisory
model_family: deepseek
task_type: analysis
version: v0.1.0
status: candidate
last_reviewed: 2026-06-11
sources:
  - deepseek-web-chat
  - deepseek-first-api-call
  - deepseek-thinking-mode
  - deepseek-deepcode-integration
  - prompt-library-policy
  - output-validation
risk_level: medium
requires:
  - browser_login_verified
  - fresh_chat
  - selected_mode
  - redacted_context
  - output_contract
forbidden:
  - secrets
  - raw_logs
  - full_repository_context
  - source_of_truth_claim
  - api_or_cli_claim_without_key
expected_output: A short external advisory opinion with risks, alternatives, and verification needs.
evals:
  - 05-evaluation/checklist.md
---

# DeepSeek Manual Web Advisory

Use this prompt contract only for the verified free web path at
`https://chat.deepseek.com/`. It is a manual browser-login advisory path, not a
CLI, API runtime, connector, default worker, approval authority, or source of
truth.

Official API and terminal-agent paths remain separate. DeepSeek API examples,
Deep Code, Claude Code, OpenCode, and similar terminal integrations require a
DeepSeek API key. Do not describe the web-login session as a command-line
runtime.

## Mode Selection

Start from a fresh chat every time.

- Use `Rychly` / Quick for short sanity checks, alternative wording, simple
  critique, or low-latency second opinions.
- Use `Expert` for architecture, security, edge-case, planning, or reasoning
  critique.
- If testing the mode itself, start one fresh chat for Quick and another fresh
  chat for Expert, then verify the chat header after sending.
- Treat `Hluboke premysleni` / deep thinking as a separate UI control. Expert
  may enable it automatically, but Quick can also show thinking if the toggle is
  left on.

## Input Packet

Paste only a compact, redacted packet:

```md
# DeepSeek Advisory Packet

Role: external advisory reviewer.
Authority: advisory only. Do not approve implementation and do not treat your
answer as source of truth.

Mode requested: Quick | Expert.
Task:
- 

Verified facts:
- 

Assumptions:
- 

Constraints:
- no secrets, credentials, customer data, raw logs, private identifiers, or full
  repository dumps
- keep the answer concise
- mark factual, API, library, pricing, security, or implementation claims as
  verification_needed unless already proven in the packet

Output format:
1. Short answer
2. Risks or objections
3. Better alternative if any
4. What must be verified locally or in official docs
5. Advisory verdict: use | do_not_use | needs_more_evidence
```

## Missing Input Fallback

If the owner asks for DeepSeek advice but does not provide a concrete prompt,
do not send an empty or broad request. Build the smallest safe packet from local
context:

```md
# DeepSeek Advisory Packet

Role: external advisory reviewer.
Authority: advisory only.

Mode requested: Expert.
Task:
- Review the proposed decision below and look for missing risks, simpler
  alternatives, and verification gaps.

Verified facts:
- [one local fact with source pointer]
- [one observed browser/test fact, if available]

Assumptions:
- [explicit assumption]

Question:
- Is this direction reasonable as an advisory opinion, and what must be checked
  before adoption?

Output format:
1. Short answer
2. Risks or objections
3. Better alternative if any
4. Verification needed
5. Advisory verdict
```

If there is not enough safe local context to fill at least one verified fact and
one concrete question, stop and ask the owner for a bounded prompt.

## Aftercare

After DeepSeek responds:

- copy back only the short advisory summary, not raw private context
- separate verified facts, model suggestions, assumptions, and risks
- verify factual or technical claims through local files, tests, Context7 when
  connected, official docs, or controlled browser evidence
- discard advice that asks for broad private context, secrets, remote mutation,
  or unverified source-of-truth authority
