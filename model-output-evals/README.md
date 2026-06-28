# Model Output Evals

This directory stores bounded, redacted evaluation records for model or worker
outputs that affect Autopilot prompts, handoffs, routing, governance,
architecture, security, or delivery decisions.

It is not raw transcript storage, a prompt-management SaaS, a runtime queue, or
an approval authority.

## Files

- `model-output-eval-record.schema.json` defines the deterministic record
  shape.
- `examples/` contains non-authoritative fixtures used by the validator and
  tests.
- `records/` is where real eval records may be added after review.

## Rules

Every real record must:

- score all model-output dimensions from `0` to `100`
- record provider best-practice source IDs from
  `prompt-library/source-catalog.json`
- keep only summaries, pointers, and verification evidence
- record prompt/input deltas before reruns
- require route review after repeated similar failures
- keep weekly tuning based on collected records, not anecdotes

Never store raw prompts, raw model output, raw logs, full transcripts, secrets,
credentials, customer data, or unredacted private context in this directory.

Validate with:

```powershell
npm.cmd run model-output:validate
```
