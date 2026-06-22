# Change Request Rules

Every new request during a project must be classified before implementation.

## Classes

- A: clarification of original goal
- B: scope expansion
- C: direction change
- D: backlog idea
- E: conflict with goal

## Required Output

```json
{
  "request": "",
  "classification": "A|B|C|D|E",
  "reason": [],
  "recommendation": "",
  "requires_scope_change": false
}
```

## Conflict Rule

If the request conflicts with the goal, Autopilot must not blindly implement it.
It must explain the conflict, propose a safer alternative, and ask whether the
project priority or scope should change.

## Backlog Rule

Useful ideas that do not support the current critical user action go to
`OUT_OF_SCOPE.md` or the project backlog.
