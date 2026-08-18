---
title: "Automatic Multi-Instance Schema Migrations"
status: "idea"
author: "human"
created: "2026-08-13"
---

## Summary
Implement an automatic, bulletproof schema migration system that updates single-tenant database instances on application boot. Supports both local user installations and ephemeral cloud containers without manual operator intervention.

## Motivation / Use Case
Kalaido operates on a single-tenant architecture with many independent database instances running on user laptops and cloud environments. When an application update introduces schema changes, each database instance must update automatically on startup. Because migrations run autonomously on end-user machines rather than under manual operator control, the system must be completely reliable, non-destructive, and thoroughly tested.

## Proposed Concept
1. **Schema Artifact Structure**:
   - **Authoritative Latest Schema**: A single, up-to-date schema file used to directly bootstrap new scopes without needing to replay historical migrations.
   - **Baseline Schema**: The initial "first launched" schema version.
   - **Sequential Migrations**: Ordered migration definitions to transition a database step-by-step from any historical version to the latest.
2. **Safe Migration Policy**:
   - Enforce restricted schema modifications (e.g., additive-only: never delete, never rename) to prevent data loss or destructive breaking changes across distributed instances.
3. **Boot Execution Mechanics**:
   - On application startup (both local and ephemeral cloud instances), inspect the database version.
   - If older than current binary version, apply necessary sequential migrations atomically.
4. **Comprehensive Test Suite**:
   - Automated tests verifying that initializing a fresh database via the authoritative schema produces an identical schema state to running all sequential migrations from baseline.
   - Integration tests replaying migrations from every previous version up to the latest.

## Open Questions
- How is the current schema version tracked within each database instance (e.g., internal metadata table)?
- What DSL or format should be used for sequential migrations (e.g., SQL files, code migration handlers, or declarative schema diffs)?
- What strategy should be used for crash recovery or rollback if a boot-time migration encounters an unexpected error on a user's machine (e.g., automatic pre-migration DB backups)?
- How should the system handle version skew if a client encounters a database modified by a newer application version?
