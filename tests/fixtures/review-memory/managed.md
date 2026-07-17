# Managed Review Memory

### MM-01 — WAL precedes mutation

Write and validate the pending record before publication.

Regression coverage: `test_wal_precedes_mutation`.

### MM-02 — Rollback restores identity

Restore the complete before identity before clearing recovery state.

Regression coverage: `test_rollback_restores_identity`.
