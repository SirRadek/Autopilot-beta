# Review memory operating protocol

Review memory preserves confirmed invariant findings as small project-local
Markdown documents under `docs/superpowers/review-memory/`. Its purpose is to
make a focused delta review check the changed code and relevant earlier lessons
without repeatedly reconstructing the same history. It does not replace tests,
high-risk evidence, or the complete branch review required before release.

## Durable memory format

Each invariant heading uses the exact form `### ID — title`, where `ID` matches
`[A-Z][A-Z0-9]*-[0-9]{2}`. The body explains the durable rule and points to its
regression test. IDs are unique across all memory documents in one project.

A confirmed new finding is not closed until its failing regression test is
recorded and the project adds a new or amended invariant. Domain-specific memory
stays in the governed project; Autopilot records its path, SHA-256 digest, and
selected IDs but does not copy the document contents into operational state.

## Focused delta lifecycle

The implementer records:

- an explicit base and head Git commit;
- the affected invariant IDs, or a bounded reason that no existing memory
  applies;
- stable focused check IDs, their status, and optional repository-relative test
  source paths;
- the accepted design or implementation plan as a separate source pointer.

Generate a packet with relevant memory:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  npm run --silent review:packet -- \
  --root /path/to/project \
  --base <last-reviewed-commit> \
  --head <fixed-head> \
  --mode delta \
  --affected MM-02 \
  --check focused-state:passed:tests/state.test.ts
```

When no durable memory applies, make that decision explicit:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  npm run --silent review:packet -- \
  --root /path/to/project \
  --base <last-reviewed-commit> \
  --head <fixed-head> \
  --mode delta \
  --no-memory-reason "Only non-governed explanatory prose changed."
```

The reviewer receives the packet, selected memory files, accepted design/plan,
and the local Git delta. A targeted re-review uses the last reviewed head as its
base and reads only the fixed delta plus necessary surrounding invariants. When
declared deterministic evidence is complete, it does not repeat a reported full
suite merely to rediscover the same evidence.

## Complete branch review

Before release, generate a packet that selects every discovered memory file:

```bash
PATH=/home/radek/.local/bin:/home/radek/.local/node-v24.18.0-linux-x64/bin:$PATH \
  npm run --silent review:packet -- \
  --root /path/to/project \
  --base <branch-base> \
  --head <release-head> \
  --mode release \
  --check full-suite:passed:
```

Release mode requires the complete branch diff, every durable memory document,
and release-gate evidence. Review memory never narrows the final release review
or weakens independent high-risk review.

## Privacy and authority

The packet sets `contains_raw_content` to `false`. It includes full Git commit
identities, changed repository-relative paths, memory paths and digests,
invariant IDs, bounded no-memory reason, and check metadata. It excludes diff
contents, source contents, Markdown bodies, commit messages, prompts, responses,
raw model output, raw test logs, credentials, and environment values.

The generator is deterministic and local. It does not dispatch a reviewer,
approve delivery, mutate a remote, or select a provider. Adding review memory
does not activate routing and does not change the active model or reasoning
effort. Model and reasoning recommendations remain shadow-only and null until a
separately approved routing phase passes its evidence gates.

## Efficiency evidence

Packet generation proves bounded context selection, not token savings. Do not
claim a 30 percent saving until the existing matched comparison contains at
least 20 ordinary and 5 high-risk completed comparable work units in both
windows and passes all quality gates. Until then the result remains
`insufficient_evidence`.
