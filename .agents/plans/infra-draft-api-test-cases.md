# Kalaido API Integration Test Suite (To-Do List)

This document is an actionable, self-contained implementation checklist for human engineers writing API integration tests against the Kalaido PocketBase backend (`kalaido/kalaidoscope/`). Each test item is formatted as a standalone table containing complete request payloads, prerequisite setups, expected HTTP status codes, response assertions, and database assertions.

All tests run against the single-tenant PocketBase HTTP server, using a deterministic mock LLM factory (`llm.SetProviderFactory`).

Items marked **[OPTIONAL]** are a genuine choice, not a spec requirement. Items marked **[DEFERRED]** are additional functionality whose absence does not make the system incorrect against `model.md`.

**Prerequisite — controllable clock.** Tests 1.2, 4.5, 6.4 and 6.7 require the server's notion of "now" to be set or advanced. No such seam exists: `time.Now()` is called directly in `status.NewEvaluator` (`internal/handlers/status.go`) and `engine.GetPendingWindows` (`internal/engine/reflections.go`). Designing the seam is engine work and is out of scope for this pass, but these tests cannot be written until it exists.

**Prerequisite — JSON wire format.** Payloads below are written in `snake_case`; the shipped structs in `internal/api/` are `camelCase`. The decision is recorded in `api-updates.md` and governs every payload here. Treat the payloads as notation until it is made.

**Prerequisite — no Go test infrastructure exists.** The repository currently contains zero `_test.go` files. `./kalaido.sh test:go` has nothing to run, so the first item of work is a harness: a PocketBase test app, migration bootstrap, the mock LLM factory, and per-test database isolation.

---

## Suite 1: Fragment Ingestion, Types, Immutability & Event Dates

### Test 1.1: Canonical Fragment Type Ingestion
- [ ] **Test 1.1: Canonical Fragment Type Ingestion**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Inputs & Classification → Fragment → Content & Sources |
| **Feature / Invariant** | All 8 canonical fragment types (`email`, `text_message`, `note`, `slack_message`, `whatsapp_message`, `github_commit`, `document`, `scraped_webpage`) must be accepted and persisted correctly. |
| **Endpoints** | `POST /api/ingest` |
| **Setup State** | Clean database state. |
| **Input Payload** | `<pre>{<br>  "format": "text",<br>  "items": [<br>    {"type": "email", "content": "Email content", "source": "email.txt", "source_time": "2024-01-01T10:00:00Z"},<br>    {"type": "text_message", "content": "SMS content", "source": "sms.txt", "source_time": "2024-01-01T10:05:00Z"},<br>    {"type": "note", "content": "Note content", "source": "note.txt", "source_time": "2024-01-01T10:10:00Z"},<br>    {"type": "slack_message", "content": "Slack content", "source": "slack.txt", "source_time": "2024-01-01T10:15:00Z"},<br>    {"type": "whatsapp_message", "content": "WhatsApp content", "source": "wa.txt", "source_time": "2024-01-01T10:20:00Z"},<br>    {"type": "github_commit", "content": "Commit content", "source": "git.txt", "source_time": "2024-01-01T10:25:00Z"},<br>    {"type": "document", "content": "Doc content", "source": "doc.txt", "source_time": "2024-01-01T10:30:00Z"},<br>    {"type": "scraped_webpage", "content": "Web content", "source": "web.txt", "source_time": "2024-01-01T10:35:00Z"}<br>  ]<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | `ingested == 8`, `status == "completed"`, `error` is empty/null. |
| **Database Assertions** | Query `fragment` table. Exactly 8 records exist, each matching its respective `type` string. |

---

### Test 1.2: Event Date vs Import Date Separation
- [ ] **Test 1.2: Event Date vs Import Date Separation**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Inputs & Classification → Fragment → Temporal Tracking |
| **Feature / Invariant** | Fragment creation sets `created` to current server system clock (Import Date) while preserving `event_date` (formerly `source_time`) as the historical event timestamp. |
| **Endpoints** | `POST /api/ingest` |
| **Setup State** | Server system clock is set or simulated at `2024-08-01T12:00:00Z`. |
| **Input Payload** | `<pre>{<br>  "format": "text",<br>  "items": [<br>    {<br>      "type": "email",<br>      "content": "Backdated email from January",<br>      "source": "jan_email.eml",<br>      "source_time": "2024-01-15T08:30:00Z"<br>    }<br>  ]<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | `ingested == 1`, `status == "completed"`. |
| **Database Assertions** | Fetch created `fragment` record. Assert `event_date == "2024-01-15 08:30:00.000Z"` and `created == "2024-08-01 12:00:00.000Z"`. |

---

### Test 1.3: Fragment Field Immutability Enforcement
- [ ] **Test 1.3: Fragment Field Immutability Enforcement**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Inputs & Classification → Fragment → Immutability Scope |
| **Feature / Invariant** | Ingested fragment records (`content`, `type`, `event_date`) are strictly immutable once created. **Currently fails:** the `fragment` collection sets no `DisableWriteOperations`, so its `UpdateRule` is `@request.auth.id != ''` and these fields are freely writable. Depends on the collection rule change in `schema-updates.md` § 1. |
| **Endpoints** | `PATCH /api/collections/fragment/records/{id}` |
| **Setup State** | Ingest Fragment $F_1$ (`id: "frag_123"`, `content: "Original Content"`). |
| **Input Payload** | `<pre>{<br>  "content": "Tampered Content",<br>  "event_date": "2025-01-01T00:00:00Z"<br>}</pre>` |
| **HTTP Status** | `403 Forbidden` or `400 Bad Request` |
| **Response Assertions** | Error response indicating write/update on `fragment` is disabled or forbidden. |
| **Database Assertions** | Re-fetch Fragment $F_1$. Assert `content` remains `"Original Content"`. |

---

### [OPTIONAL] Test 1.4: Duplicate Fragment Ingestion Handling
- [ ] **[OPTIONAL] Test 1.4: Duplicate Fragment Ingestion Handling**

| Property | Detail |
|---|---|
| **Model Reference** | *None.* `model.md` has no section on ingest duplicate handling — the previously cited "§ Inputs & Classification → Ingest" does not exist. This tests existing `skip_duplicates` behaviour, not spec conformance. |
| **Feature / Invariant** | Setting `skip_duplicates: true` during ingest ignores identical content and prevents duplicate fragment creation. |
| **Endpoints** | `POST /api/ingest` |
| **Setup State** | Ingest Fragment $F_1$ with content `"Unique body text XYZ"`. |
| **Input Payload** | `<pre>{<br>  "format": "text",<br>  "skip_duplicates": true,<br>  "items": [<br>    {"type": "note", "content": "Unique body text XYZ", "source": "note.txt"}<br>  ]<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | `ingested == 0`. |
| **Database Assertions** | Total count of records in `fragment` table remains 1. |

---

## Suite 2: Colour Tagging, Backfill & Archiving Invariants

### Test 2.1: Fragment Immutability Under Colour Tagging
- [ ] **Test 2.1: Fragment Immutability Under Colour Tagging**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Inputs & Classification → Fragment → Immutability Scope |
| **Feature / Invariant** | Adding a Colour tag creates a record in `colour_fragment` without mutating the `fragment` table or changing fragment `updated` timestamps. |
| **Endpoints** | `POST /api/colours` |
| **Setup State** | Ingest Fragment $F_1$ (`content: "Project Alpha launch status"`). Record $F_1$'s initial `updated` timestamp $T_{orig}$. |
| **Input Payload** | `<pre>{<br>  "name": "Alpha Project",<br>  "prompt": "Mentions Project Alpha",<br>  "applyRetroactively": true<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns created Colour record object with assigned ID. |
| **Database Assertions** | Row created in `colour_fragment` table (`fragment_id: F1_id`, `match_type: "llm_matched_backfill"`). Fragment $F_1$'s `updated` timestamp in `fragment` table equals $T_{orig}$ exactly. |

---

### Test 2.2: Retroactive Colour Backfill on Creation
- [ ] **Test 2.2: Retroactive Colour Backfill on Creation**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Inputs & Classification → Colour → Lifecycle & Classification Events |
| **Feature / Invariant** | Creating a new Colour executes an asynchronous backfill that tags all matching pre-existing fragments with `match_type: "llm_matched_backfill"`. |
| **Endpoints** | `POST /api/colours` |
| **Setup State** | Ingest Fragments $F_1$ ("Urgent bug in login") and $F_2$ ("Lunch menu note"). |
| **Input Payload** | `<pre>{<br>  "name": "Urgent",<br>  "prompt": "Is an urgent issue or bug",<br>  "applyRetroactively": true<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns created Colour record. |
| **Database Assertions** | Query `colour_fragment` for the new colour ID. Exactly 1 record exists linking to $F_1$, with `match_type == "llm_matched_backfill"`. $F_2$ is not tagged. |

---

### Test 2.3: Definition Update Freeze (No Retroactive Reclassification)
- [ ] **Test 2.3: Definition Update Freeze (No Retroactive Reclassification)**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Inputs & Classification → Colour → Definition Updates |
| **Feature / Invariant** | Updating an existing Colour's criteria via `PATCH` does NOT retroactively evaluate past fragments that failed to match at ingest time. |
| **Endpoints** | `PATCH /api/colours/{id}` |
| **Setup State** | Create Colour $C_1$ (prompt: "Mentions Go"). Ingest Fragment $F_1$ ("Mentions Rust"). $F_1$ is not tagged with $C_1$. |
| **Input Payload** | `<pre>{<br>  "prompt": "Mentions Go or Rust"<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns updated Colour record with new criteria. |
| **Database Assertions** | Query `colour_fragment` for $C_1$ and $F_1$. No match record exists ($F_1$ remains un-tagged because definition updates do not trigger backfills). |

---

### Test 2.4: Colour Archiving & Tag Modification Lock
- [ ] **Test 2.4: Colour Archiving & Tag Modification Lock**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Inputs & Classification → Colour → Archiving & § Deletion & Retention |
| **Feature / Invariant** | Setting `is_archived: true` locks the colour: existing tags remain intact, but new tag assignments or tag removals on archived colours are blocked. |
| **Endpoints** | `PATCH /api/colours/{id}` |
| **Setup State** | Colour $C_1$ exists and is tagged to Fragment $F_1$. |
| **Input Payload** | Step 1: `PATCH /api/colours/{C1_id}` with `<pre>{"is_archived": true}</pre>`.<br>Step 2: Attempt manual tag association on $C_1$ for Fragment $F_2$, via whichever surface is pinned in `api-updates.md` § 7 — currently `PATCH /api/colours/{C1_id}` with `<pre>{"positiveExamples": ["F2_id"]}</pre>`. |
| **HTTP Status** | Step 1: `200 OK`.<br>Step 2: `400 Bad Request` or `422 Unprocessable Entity`. |
| **Response Assertions** | Step 1: `is_archived == true`, `archived_at` is set.<br>Step 2: Error indicates tag modifications on archived colours are prohibited. |
| **Database Assertions** | $C_1 \to F_1$ tag association remains in `colour_fragment`. $C_1 \to F_2$ tag association is NOT created. |

---

### Test 2.5: Colour Outright Deletion Prohibition
- [ ] **Test 2.5: Colour Outright Deletion Prohibition**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Deletion & Retention → Colour Archiving |
| **Feature / Invariant** | Colours cannot be deleted outright from the system. **Already satisfied:** the `colour` collection sets `DisableWriteOperations: true`, so `DeleteRule` is nil. This is a regression guard, not new work. |
| **Endpoints** | `DELETE /api/collections/colour/records/{id}` |
| **Setup State** | Colour $C_1$ exists. |
| **Input Payload** | `DELETE /api/collections/colour/records/{C1_id}` |
| **HTTP Status** | `405 Method Not Allowed` or `400 Bad Request` |
| **Response Assertions** | Error indicating delete operation on `colour` collection is disabled. |
| **Database Assertions** | Colour $C_1$ remains present in `colour` table. |

---

## Suite 3: Context Spec Resolution & Constraint Verification

### Test 3.1: Whole Scope Selection Semantics
- [ ] **Test 3.1: Whole Scope Selection Semantics**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Context Spec → Scoping Modes |
| **Feature / Invariant** | `whole_scope: true` in Context Spec resolves all non-deleted fragments in the single workspace instance, suppressing fragment-level filters. |
| **Endpoints** | `POST /api/context/tokens` |
| **Setup State** | Ingest Fragments $F_1$ (`type: email`), $F_2$ (`type: note`), and $F_3$ (`type: slack_message`). |
| **Input Payload** | `<pre>{<br>  "context_spec": {<br>    "whole_scope": true,<br>    "fragment_types": ["email"]<br>  }<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Resolved fragment IDs list in response contains all 3 fragments $\{F_1, F_2, F_3\}$ (type filter ignored when `whole_scope` is true). |
| **Database Assertions** | Database unchanged (query endpoint). |

---

### Test 3.2: Filtered Selection UNION Aggregation
- [ ] **Test 3.2: Filtered Selection UNION Aggregation**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Context Spec → Filter Criteria |
| **Feature / Invariant** | Filter criteria (explicit fragment IDs, fragment types, and colour tags) resolve to the UNION of matching non-deleted fragments without duplicates. |
| **Endpoints** | `POST /api/context/tokens` |
| **Setup State** | Ingest $F_1$ (`type: note`, tagged $C_1$), $F_2$ (`type: email`, tagged $C_1$), $F_3$ (`type: note`, untagged), $F_4$ (`type: email`, untagged). |
| **Input Payload** | `<pre>{<br>  "context_spec": {<br>    "whole_scope": false,<br>    "colour_ids": ["C1_id"],<br>    "fragment_types": ["note"],<br>    "explicit_fragment_ids": ["F4_id"]<br>  }<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Resolved fragment IDs set contains exactly $\{F_1, F_2, F_3, F_4\}$ with zero duplicates. |
| **Database Assertions** | Database unchanged. |

---

### Test 3.3: Reflection Leaf Node Input Restriction
- [ ] **Test 3.3: Reflection Leaf Node Input Restriction**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Context Spec → Reflection Input Constraint |
| **Feature / Invariant** | Reflections are leaf nodes and cannot consume Source Projections or Source Reflections. Creating/updating a Reflection with source syntheses must be rejected. |
| **Endpoints** | `POST /api/reflections` |
| **Setup State** | Projection $P_1$ exists. |
| **Input Payload** | `<pre>{<br>  "name": "Invalid Reflection",<br>  "context_spec": {<br>    "whole_scope": false,<br>    "source_projection_ids": ["P1_id"]<br>  },<br>  "window_spec": {<br>    "mode": "relative",<br>    "start_time": "2024-01-01T00:00:00Z",<br>    "duration": "24h",<br>    "period": "24h"<br>  }<br>}</pre>` |
| **HTTP Status** | `400 Bad Request` |
| **Response Assertions** | Error specifies Reflections cannot contain source projections or source reflections. |
| **Database Assertions** | Reflection record is NOT created in `reflection` table. |

---

### Test 3.4: Source Projection Resolution to Active Approved Snapshot
- [ ] **Test 3.4: Source Projection Resolution to Active Approved Snapshot**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Resolved Context → Reproducibility & Source Projection Resolution |
| **Feature / Invariant** | Source Projections resolve to the single active Approved Snapshot ID (highest `approval_sequence_number`). |
| **Endpoints** | `POST /api/projections/{id}/candidates` |
| **Setup State** | Projection $P_{source}$ exists with two Approved Snapshots: $S_1$ (`approval_sequence_number: 1`) and $S_2$ (`approval_sequence_number: 2`). Create Projection $P_{downstream}$ with `context_spec: {"source_projection_ids": ["P_source_id"]}`. |
| **Input Payload** | `POST /api/projections/{P_downstream_id}/candidates` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns generated Candidate Snapshot response. |
| **Database Assertions** | Fetch generated Candidate Snapshot for $P_{downstream}$. Inspect `resolved_context.source_projection_snapshot_ids`. Assert it contains `["S2_id"]` and excludes `"S1_id"`. |

---

### Test 3.5: Source Reflection `Last N` Rule & Window Clamping
- [ ] **Test 3.5: Source Reflection `Last N` Rule & Window Clamping**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Context Spec → Source Reflection (`Last N` Rule) |
| **Feature / Invariant** | Source Reflection inputs resolve up to $N$ most recent materialized windows with active approved snapshots, clamping $N$ to available materialized windows. |
| **Endpoints** | `POST /api/projections/{id}/candidates` |
| **Setup State** | Reflection $R_{source}$ has 3 materialized windows $W_1, W_2, W_3$ (ordered chronologically) with approved snapshots $S_{W1}, S_{W2}, S_{W3}$. Create Projection $P_{downstream}$ consuming $R_{source}$ with `last_n: 5`. |
| **Input Payload** | `POST /api/projections/{P_downstream_id}/candidates` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns generated Candidate Snapshot response. |
| **Database Assertions** | Inspect generated candidate for $P_{downstream}$. `resolved_context.source_reflection_snapshot_ids` contains exactly `["S_W1_id", "S_W2_id", "S_W3_id"]` in chronological order (clamped from 5 to 3). |

---

### Test 3.6: Projection Cycle Rejection at Spec-Edit Time
- [ ] **Test 3.6: Projection Cycle Rejection at Spec-Edit Time**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Dependency Graph & Cascading Updates (DAG) |
| **Feature / Invariant** | Circular references are strictly prohibited. Because Reflections are leaf-only, the only structurally possible cycle is Projection → Projection, and it must be rejected when the spec is saved — not deferred to resolution time. |
| **Endpoints** | `PATCH /api/projections/{id}` |
| **Setup State** | Projection $P_1$ exists. Projection $P_2$ exists with `context_spec: {"source_projection_ids": ["P1_id"]}` (so $P_2$ consumes $P_1$). |
| **Input Payload** | `<pre>PATCH /api/projections/{P1_id}<br>{<br>  "current_context_spec": {<br>    "whole_scope": false,<br>    "source_projection_ids": ["P2_id"]<br>  }<br>}</pre>` |
| **HTTP Status** | `400 Bad Request` |
| **Response Assertions** | Error states the update would introduce a circular dependency. |
| **Database Assertions** | Projection $P_1$'s `current_context_spec` is unchanged and contains no `source_projection_ids`. Extend with a 3-node case ($P_1 \to P_2 \to P_3 \to P_1$) to confirm the check walks the transitive closure rather than only direct self-reference. |

---

### Test 3.7: Explicit Fragment Pinning & Deletion Override
- [ ] **Test 3.7: Explicit Fragment Pinning & Deletion Override**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Context Spec → Filter Criteria (Explicit Fragments) |
| **Feature / Invariant** | A pinned Fragment is always included regardless of type or colour, but deletion removes it from all future context resolution "whether it was pinned or matched by rule". Pinning does not survive deletion. |
| **Endpoints** | `POST /api/context/tokens` → `DELETE /api/collections/fragment/records/{id}` → `POST /api/context/tokens` |
| **Setup State** | Ingest $F_1$ (`type: note`, untagged) and $F_2$ (`type: email`, untagged). |
| **Input Payload** | Step 1: Resolve `<pre>{<br>  "context_spec": {<br>    "whole_scope": false,<br>    "fragment_types": ["note"],<br>    "explicit_fragment_ids": ["F2_id"]<br>  }<br>}</pre>`<br>Step 2: `DELETE /api/collections/fragment/records/{F2_id}`.<br>Step 3: Resolve the identical payload again. |
| **HTTP Status** | `200 OK` for all calls. |
| **Response Assertions** | Step 1: resolved set is $\{F_1, F_2\}$ — $F_2$ is included by pin despite failing the type filter.<br>Step 3: resolved set is $\{F_1\}$ — the pin does not resurrect a deleted fragment. |
| **Database Assertions** | $F_2$ has `deleted_at` set and is still present as a row (soft delete, not removed). |

---

### Test 3.8: Whole Scope Retains Source Composition (Projections Only)
- [ ] **Test 3.8: Whole Scope Retains Source Composition (Projections Only)**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Context Spec → Scoping Modes |
| **Feature / Invariant** | `whole_scope: true` suppresses **fragment-level** Filter Criteria only. Explicit Source Composition inputs (Source Projections / Reflections) remain attached and must still resolve. Test 3.1 asserts the suppression half; this asserts the retention half. |
| **Endpoints** | `POST /api/context/tokens` |
| **Setup State** | Ingest Fragments $F_1$, $F_2$. Projection $P_{source}$ exists with active Approved Snapshot $S_1$. |
| **Input Payload** | `<pre>{<br>  "context_spec": {<br>    "whole_scope": true,<br>    "fragment_types": ["email"],<br>    "explicit_fragment_ids": ["F1_id"],<br>    "source_projection_ids": ["P_source_id"]<br>  }<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Resolved fragment IDs contain all workspace fragments $\{F_1, F_2\}$ (type filter and pin both suppressed as redundant), AND resolved snapshot IDs contain $S_1$ (source composition NOT suppressed). |
| **Database Assertions** | Database unchanged (query endpoint). |

---

## Suite 4: Window Spec, Versioning & Materialisation Rules (Reflections)

### Test 4.1: Half-Open Boundary Window Filtering
- [ ] **Test 4.1: Half-Open Boundary Window Filtering**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Window Spec → Boundary Semantics |
| **Feature / Invariant** | Fragment $F$ belongs to window $w$ if and only if $w.start \le F.event\_date < w.end$. |
| **Endpoints** | `POST /api/reflections/{id}/generate-snapshot` |
| **Setup State** | Create Reflection $R_1$ with absolute window $[2024-01-01T10:00:00Z, 2024-01-01T11:00:00Z)$. Ingest $F_1$ (`event_date: 2024-01-01T10:00:00Z`), $F_2$ (`event_date: 2024-01-01T10:59:59Z`), $F_3$ (`event_date: 2024-01-01T11:00:00Z`). |
| **Input Payload** | `POST /api/reflections/{R1_id}/generate-snapshot` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns array of created snapshot IDs. |
| **Database Assertions** | Inspect generated snapshot's `resolved_context.fragment_ids`. Contains $\{F_1, F_2\}$ and strictly excludes $F_3$. |

---

### Test 4.2: Tumbling, Overlapping & Gapped Window Grid Computations
- [ ] **Test 4.2: Tumbling, Overlapping & Gapped Window Grid Computations**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Window Spec → Duration vs. Period Relationship |
| **Feature / Invariant** | Window grid boundaries compute correctly for tumbling (`Duration == Period`), overlapping (`Duration > Period`), and gapped (`Duration < Period`) modes. |
| **Endpoints** | `POST /api/reflections` → `POST /api/reflections/{id}/generate-snapshot` |
| **Setup State** | Clean database state. Clock at `2024-01-02T00:00:00Z`, so exactly one grid point has been reached for each Reflection. |
| **Input Payload** | Create relative Reflections, then generate a snapshot for each:<br>1. $R_{tumb}$ (`Start: 2024-01-01T00:00Z`, `Duration: 24h`, `Period: 24h`)<br>2. $R_{over}$ (`Start: 2024-01-01T00:00Z`, `Duration: 7d`, `Period: 24h`)<br>3. $R_{gap}$ (`Start: 2024-01-01T00:00Z`, `Duration: 1h`, `Period: 24h`) |
| **HTTP Status** | `200 OK` for all calls. |
| **Response Assertions** | Returns created Reflection record objects, then generated snapshot ID arrays. |
| **Database Assertions** | Assert the **computed** boundaries on each generated snapshot's `resolved_window` (NOT on `window_spec_versions`, which stores the spec — `version_number`, `effective_from`, mode, duration, period — and never computed windows):<br>- $R_{tumb}$: $[00:00, 24:00)$ — grid point at $24{:}00$, lookback 24h.<br>- $R_{over}$: $[00:00, 24:00)$ — grid point at $24{:}00$, 7-day lookback truncated forward to `Start Time` (first-window truncation).<br>- $R_{gap}$: $[23:00, 24:00)$ — grid point at $24{:}00$, 1h lookback, leading 23h un-evaluated and NOT truncated back to `Start Time`.<br>Cross-check the same boundaries against the windows reported by `GET /api/rotation`. |

---

### Test 4.3: Leading Gap Invariant (No Truncation in Gapped Mode)
- [ ] **Test 4.3: Leading Gap Invariant (No Truncation in Gapped Mode)**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Window Spec → Gapped Windows & Duration vs. Period |
| **Feature / Invariant** | In gapped mode (`Duration < Period`), the leading gap after Start Time is NOT truncated away. Fragments in the leading gap belong to no window and trigger no staleness. |
| **Endpoints** | `POST /api/ingest` → `GET /api/rotation` |
| **Setup State** | Reflection $R_1$ created with `Start: 2024-01-01T00:00:00Z`, `Duration: 1h`, `Period: 24h`. First window grid point is $2024-01-01T24:00:00Z$ covering $[23:00, 24:00]$. |
| **Input Payload** | Ingest Fragment $F_1$ with `event_date: 2024-01-01T05:00:00Z` (falling in leading 23-hour gap). Query `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Response shows zero stale windows for $R_1$. $F_1$ belongs to no window. |
| **Database Assertions** | $R_1$ remains fresh in database calculations. |

---

### Test 4.4: Append-Only Window Spec Edit Versioning
- [ ] **Test 4.4: Append-Only Window Spec Edit Versioning**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Window Spec → Window Spec Edits & Versioning |
| **Feature / Invariant** | Updating a Reflection's Window Spec appends a new version object with `effective_from = now` to `window_spec_versions` array. Already-generated historical windows and snapshots are untouched. |
| **Endpoints** | `PATCH /api/reflections/{id}` |
| **Setup State** | Reflection $R_1$ exists with Version 1 (`window_spec_versions: [{version_number: 1, ...}]`). Approved Snapshot $S_1$ generated for Window $W_1$ under Version 1. |
| **Input Payload** | `<pre>PATCH /api/reflections/{R1_id}<br>{<br>  "window_spec": {<br>    "mode": "relative",<br>    "start_time": "2024-01-01T00:00:00Z",<br>    "duration": "12h",<br>    "period": "12h"<br>  }<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns updated Reflection record. |
| **Database Assertions** | Re-fetch Reflection $R_1$. `window_spec_versions` array contains 2 elements (`version_number: 1` and `version_number: 2`). Version 2 carries `effective_from` equal to patch timestamp. Snapshot $S_1$ retains its original `resolved_window` boundaries and `window_spec_version_number: 1`. |

---

### Test 4.5: Permanent Window Materialisation
- [ ] **Test 4.5: Permanent Window Materialisation**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Window Spec → Materialized Windows |
| **Feature / Invariant** | Once a window becomes current or receives an approved snapshot, materialisation is permanent and cannot be undone by time advancing or spec edits. |
| **Endpoints** | `GET /api/rotation` |
| **Setup State** | Reflection $R_1$ has grid Window $W_1$ that was current at time $T_1$. System clock advances to $T_2$ ($T_2 > W_1.end$). No snapshot was approved for $W_1$. |
| **Input Payload** | Call `GET /api/rotation` at time $T_2$. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Response lists Window $W_1$ as a materialized, stale window requiring candidate snapshot generation. |
| **Database Assertions** | Window $W_1$ included in pending stale windows list. |

---

### [DEFERRED] Test 4.6: Explicit Historical Window Backfill Workflow
- [ ] **[DEFERRED] Test 4.6: Explicit Historical Window Backfill Workflow**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Context & Scoping → Window Spec → Window Backfill |
| **Feature / Invariant** | Invoking generate snapshot for an un-materialized historical window explicitly materializes the window and triggers candidate snapshot generation. **Deferred:** Window Backfill is additional functionality — without it history simply cannot be filled in on demand. No invariant elsewhere in the model depends on it. |
| **Endpoints** | `POST /api/reflections/{id}/generate-snapshot` |
| **Setup State** | Reflection $R_1$ has an un-materialized historical grid window $W_{hist}$ (prior to $R_1$'s creation timestamp). |
| **Input Payload** | `<pre>{<br>  "window_id": "2023-12-01T00:00:00Z_2023-12-02T00:00:00Z"<br>}</pre>`<br>*The `window_id` format is an open decision recorded in `api-updates.md` § 5; this payload assumes the readable `{start}_{end}` pair.* |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns generated snapshot ID array. |
| **Database Assertions** | Snapshot created for window $W_{hist}$ with `resolved_window` set to $[2023-12-01T00:00:00Z, 2023-12-02T00:00:00Z]$. $W_{hist}$ is now permanently materialized. |

---

### Test 4.7: Window Spec Edit Is Neither a Staleness Trigger Nor an Obsoletion Trigger
- [ ] **Test 4.7: Window Spec Edit Is Neither a Staleness Trigger Nor an Obsoletion Trigger**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Staleness Triggers → Specification Edits (parenthetical) & § Refinement Approval → Obsolete Candidate Retirement (parenthetical) |
| **Feature / Invariant** | Editing a Window Spec appends a version effective from now and leaves every existing window's `Resolved Window` and inputs untouched. Therefore: no existing target becomes stale, and a queued Candidate Snapshot stays **valid** rather than being retired obsolete. This is the negative counterpart to Test 5.5 and is the easiest rule in the model to get wrong. |
| **Endpoints** | `PATCH /api/reflections/{id}` → `GET /api/rotation` |
| **Setup State** | Reflection $R_1$ under **Manual** Approval, Version 1 window spec. Window $W_1$ has an Approved Snapshot and is fresh. Window $W_2$ has an unapproved Candidate $C_1$ (`status: "candidate"`) in the queue. `GET /api/rotation` reports no stale windows beyond $W_2$. |
| **Input Payload** | `<pre>PATCH /api/reflections/{R1_id}<br>{<br>  "window_spec": {<br>    "mode": "relative",<br>    "start_time": "2024-01-01T00:00:00Z",<br>    "duration": "12h",<br>    "period": "12h"<br>  }<br>}</pre>`<br>Then call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Stale window set is **unchanged** by the edit — $W_1$ is still not stale, and no new stale window appears until the incoming version's first window actually materializes (which arrives via Temporal Advancement, not via the edit). |
| **Database Assertions** | Candidate $C_1$ status remains `"candidate"` — NOT `"retired_obsolete"`. Reflection $R_1$'s `context_spec_updated_at` is unchanged by the window spec edit. |

---

## Suite 5: Snapshot Lifecycle, Approval Policies & Candidate Management

### Test 5.1: Manual Approval Policy Lifecycle (Projections)
- [ ] **Test 5.1: Manual Approval Policy Lifecycle (Projections)**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Snapshot Lifecycle & Approval Policies → Approval Policies |
| **Feature / Invariant** | Projections default to `approval_policy: "manual"`. Background runs place candidates in pending queue (`status: "candidate"`). Explicit user approval promotes candidate to `status: "approved"` and sets `approval_sequence_number`. |
| **Endpoints** | `POST /api/projections/{id}/candidates` → `POST /api/projections/{id}/candidates/{rid}/approve` |
| **Setup State** | Projection $P_1$ created with default `approval_policy: "manual"`. |
| **Input Payload** | Step 1: `POST /api/projections/{P1_id}/candidates`. Inspect generated snapshot ID $C_1$.<br>Step 2: `POST /api/projections/{P1_id}/candidates/{C1_id}/approve`. |
| **HTTP Status** | Step 1: `200 OK`.<br>Step 2: `200 OK`. |
| **Response Assertions** | Step 1: Returns candidate snapshot ID.<br>Step 2: Returns approved snapshot ID. |
| **Database Assertions** | Step 1: Snapshot $C_1$ created with `status: "candidate"`.<br>Step 2: Snapshot $C_1$ status updated to `"approved"`, `approval_timestamp` set, `approval_sequence_number` assigned = 1. |

---

### Test 5.2: Automatic Approval Policy Lifecycle (Reflections)
- [ ] **Test 5.2: Automatic Approval Policy Lifecycle (Reflections)**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Snapshot Lifecycle & Approval Policies → Automatic Approval |
| **Feature / Invariant** | Reflections default to `approval_policy: "automatic"`. Candidate generation immediately promotes candidate to `status: "approved"` without holding items in the pending queue. |
| **Endpoints** | `POST /api/reflections/{id}/generate-snapshot` |
| **Setup State** | Reflection $R_1$ created with default `approval_policy: "automatic"`. |
| **Input Payload** | `POST /api/reflections/{R1_id}/generate-snapshot` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns array containing approved snapshot ID. |
| **Database Assertions** | Generated snapshot created directly with `status: "approved"`, `approval_timestamp` set, `approval_sequence_number` assigned. Pending candidate queue is empty. |

---

### Test 5.3: Active Snapshot Derivation via Monotonic Sequence Counter
- [ ] **Test 5.3: Active Snapshot Derivation via Monotonic Sequence Counter**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Active Snapshot Resolution Rule |
| **Feature / Invariant** | Active snapshot selection is derived dynamically as `MAX(approval_sequence_number) WHERE status = 'approved'`, completely ignoring wall-clock approval timestamps. |
| **Endpoints** | `GET /api/projections/{id}` — **new endpoint**, added in `api-updates.md` § 3. It does not exist in `server.go` today, and the derivation cannot be done over the PocketBase collection endpoints. |
| **Setup State** | Projection $P_1$ has Approved Snapshot $S_1$ (`approval_sequence_number: 1`, `approval_timestamp: "2024-08-01T12:00:00Z"`). Insert Approved Snapshot $S_2$ (`approval_sequence_number: 2`, `approval_timestamp: "2024-08-01T10:00:00Z"` — clock skew simulation with earlier timestamp). |
| **Input Payload** | Query active snapshot for Projection $P_1$. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returned active snapshot is $S_2$ (because seq $2 > 1$, despite earlier wall-clock timestamp). |
| **Database Assertions** | Database unchanged. |

---

### Test 5.4: Candidate Queue Replacement (Max 1 Pending Candidate)
- [ ] **Test 5.4: Candidate Queue Replacement (Max 1 Pending Candidate)**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Refinement Approval & Candidate Retirement Rules → Candidate Queue Replacement |
| **Feature / Invariant** | Generating a new Candidate $C_2$ for a target replaces any unapproved candidate $C_1$ in the queue, retiring $C_1$ to `status: "retired_replaced"`. |
| **Endpoints** | `POST /api/projections/{id}/candidates` |
| **Setup State** | Projection $P_1$ under Manual Approval has an unapproved Candidate $C_1$ (`status: "candidate"`). |
| **Input Payload** | Ingest new matching fragment, then call `POST /api/projections/{P1_id}/candidates`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns new Candidate ID $C_2$. |
| **Database Assertions** | Snapshot $C_1$ status updated to `"retired_replaced"`. Snapshot $C_2$ status is `"candidate"`. Exactly 1 record with `status: "candidate"` exists for Projection $P_1$. |

---

### Test 5.5: Obsolete Candidate Retirement on Spec / Lens Edit
- [ ] **Test 5.5: Obsolete Candidate Retirement on Spec / Lens Edit**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Refinement Approval & Candidate Retirement Rules → Obsolete Candidate Retirement |
| **Feature / Invariant** | Modifying an entity's `current_context_spec` or compiling a new `Lens` automatically retires any unapproved candidate in the queue to `status: "retired_obsolete"`. |
| **Endpoints** | `PATCH /api/projections/{id}` |
| **Setup State** | Projection $P_1$ has unapproved Candidate $C_1$ (`status: "candidate"`). |
| **Input Payload** | `<pre>PATCH /api/projections/{P1_id}<br>{<br>  "current_context_spec": {<br>    "whole_scope": false,<br>    "fragment_types": ["note"]<br>  }<br>}</pre>` |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns updated Projection record. |
| **Database Assertions** | Re-fetch Snapshot $C_1$. `status` is updated to `"retired_obsolete"`. |

---

### Test 5.6: Promotion Restriction on Retired Candidates
- [ ] **Test 5.6: Promotion Restriction on Retired Candidates**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Refinement Approval & Candidate Retirement Rules → Latest Candidate Approval Restriction |
| **Feature / Invariant** | Attempting to approve a candidate with `status: "retired_replaced"` or `"retired_obsolete"` must be rejected. |
| **Endpoints** | `POST /api/projections/{id}/candidates/{rid}/approve` |
| **Setup State** | Projection $P_1$ has Snapshot $C_{retired}$ with `status: "retired_replaced"`. |
| **Input Payload** | `POST /api/projections/{P1_id}/candidates/{C_retired_id}/approve` |
| **HTTP Status** | `400 Bad Request` or `409 Conflict` |
| **Response Assertions** | Error states that retired candidates cannot be approved. |
| **Database Assertions** | Snapshot $C_{retired}$ status remains `"retired_replaced"`. |

---

### [DEFERRED] Test 5.7: Generation Source Provenance Tracking
- [ ] **[DEFERRED] Test 5.7: Generation Source Provenance Tracking**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Refinement Approval & Candidate Retirement Rules → Generation Provenance |
| **Feature / Invariant** | Preview snapshot approvals during chat refinement record `generation_source: "refinement_chat"`; background candidate promotions record `generation_source: "lens_execution"`. **Deferred:** matches the `generation_source` field marking in `schema-updates.md` § 7–8 — the value is recorded for audit and no rule branches on it. |
| **Endpoints** | `POST /api/projections/{id}/refinements/{rid}/commit` AND `POST /api/projections/{id}/candidates/{rid}/approve` |
| **Setup State** | Projection $P_1$ exists. |
| **Input Payload** | Step 1: Commit chat refinement preview $S_{chat}$.<br>Step 2: Approve background candidate $S_{bg}$. |
| **HTTP Status** | `200 OK` for both requests. |
| **Response Assertions** | Returns committed snapshot IDs. |
| **Database Assertions** | Re-fetch Snapshot $S_{chat}$: `generation_source == "refinement_chat"`. Re-fetch Snapshot $S_{bg}$: `generation_source == "lens_execution"`. |

---

### Test 5.8: Preview Approval Can Move the Active Snapshot Backwards
- [ ] **Test 5.8: Preview Approval Can Move the Active Snapshot Backwards**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Resolution of Staleness → "A corollary: approving a Preview can move the active snapshot backwards" |
| **Feature / Invariant** | A Preview Snapshot carries the `Resolved Context` it was generated from. Approving it supersedes whatever is active at that moment — including a **newer** Approved Snapshot the engine published while the Refinement Chat was open. The result is an active snapshot with *less* input than the one it replaced. The target is then correctly left stale by the $T_{gen}$ rule and regenerated, so nothing is lost — but the transient regression is real and is specified. |
| **Endpoints** | `POST /api/projections/{id}/refinements` → `POST /api/projections/{id}/candidates` → `POST /api/projections/{id}/candidates/{rid}/approve` → `POST /api/projections/{id}/refinements/{rid}/commit` → `GET /api/projections/{id}` |
| **Setup State** | Projection $P_1$ with active Approved Snapshot $S_1$ (`approval_sequence_number: 1`) resolving fragment set $\{F_1\}$. |
| **Input Payload** | 1. Open a Refinement Chat on $P_1$ at $T_1$ and generate Preview $S_{prev}$ (context resolved at $T_1$ → $\{F_1\}$).<br>2. Ingest matching Fragment $F_2$ at $T_2 > T_1$.<br>3. Generate candidate and approve it at $T_3$, producing $S_2$ (`approval_sequence_number: 2`, context $\{F_1, F_2\}$).<br>4. Commit the refinement at $T_4 > T_3$, promoting $S_{prev}$.<br>5. Call `GET /api/projections/{P1_id}` and `GET /api/rotation`. |
| **HTTP Status** | `200 OK` for all calls. |
| **Response Assertions** | Step 5: the active snapshot is the promoted preview (`approval_sequence_number: 3`), and its `resolved_context.fragment_ids` is $\{F_1\}$ — strictly smaller than $S_2$'s $\{F_1, F_2\}$. `GET /api/rotation` reports $P_1$ as stale. |
| **Database Assertions** | $S_2$ remains in history with `status: "approved"` and sequence 2, superseded but not deleted or mutated. $P_1$ is dynamically stale because $F_2$ arrived after the promoted preview's `generation_timestamp`. |

---

## Suite 6: Staleness Triggers & Resolution Mechanics

### Test 6.1: Fragment Ingestion & Backdated Fragment Staleness Triggers
- [ ] **Test 6.1: Fragment Ingestion & Backdated Fragment Staleness Triggers**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Staleness & Dependency Management → Staleness Triggers |
| **Feature / Invariant** | Ingesting a new fragment flags all entities whose Context Spec matches it as stale. For Reflections, it flags all materialized windows covering its event date. |
| **Endpoints** | `POST /api/ingest` → `GET /api/rotation` |
| **Setup State** | Projection $P_1$ consumes `fragment_types: ["email"]` (currently fresh). Reflection $R_1$ covers Window $W_1$ $[2024-01-01, 2024-01-02]$ (currently fresh). |
| **Input Payload** | Ingest email fragment $F_1$ with `event_date: "2024-01-01T15:00:00Z"`. Call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Response lists Projection $P_1$ as stale, and Reflection $R_1$ Window $W_1$ as stale. |
| **Database Assertions** | Dynamic calculation identifies $P_1$ and $R_1$ ($W_1$) as stale. |

---

### Test 6.2: Upstream Projection Approval Propagation
- [ ] **Test 6.2: Upstream Projection Approval Propagation**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Staleness & Dependency Management → Upstream Synthesis Approval |
| **Feature / Invariant** | Publishing a new Approved Snapshot on Source Projection $P_1$ flags dependent Projection $P_2$ stale. |
| **Endpoints** | `POST /api/projections/{P1_id}/candidates/{rid}/approve` → `GET /api/rotation` |
| **Setup State** | $P_1 \to P_2$ dependency graph. Both entities currently fresh. |
| **Input Payload** | Approve new Candidate Snapshot on $P_1$. Call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Response lists Projection $P_2$ as stale. |
| **Database Assertions** | Dynamic calculation identifies $P_2$ as stale. |

---

### Test 6.3: Upstream Reflection `Last N` Membership Trigger
- [ ] **Test 6.3: Upstream Reflection `Last N` Membership Trigger**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Staleness & Dependency Management → Upstream Synthesis Approval |
| **Feature / Invariant** | Downstream Projection $P_{down}$ is flagged stale when Source Reflection $R_{src}$ publishes a new Approved Snapshot for a window inside $P_{down}$'s `Last N` set. |
| **Endpoints** | `POST /api/reflections/{R_src_id}/generate-snapshot` → `GET /api/rotation` |
| **Setup State** | Projection $P_{down}$ consumes Reflection $R_{src}$ with `last_n: 3`. $R_{src}$ has active windows $W_1, W_2, W_3$. Both clean. |
| **Input Payload** | Generate and approve new snapshot for window $W_2$ on $R_{src}$. Call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Projection $P_{down}$ is returned in the stale entities list. |
| **Database Assertions** | Dynamic calculation identifies $P_{down}$ as stale. |

---

### Test 6.4: Generation Timestamp Staleness Clearance Invariant
- [ ] **Test 6.4: Generation Timestamp Staleness Clearance Invariant**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Staleness & Dependency Management → Resolution of Staleness |
| **Feature / Invariant** | A snapshot clears staleness ONLY for triggers that fired at or before its generation timestamp ($T_{gen}$). Triggers firing after $T_{gen}$ survive approval, leaving the target stale. |
| **Endpoints** | `POST /api/projections/{id}/candidates` → `POST /api/ingest` → `POST /api/projections/{id}/candidates/{rid}/approve` → `GET /api/rotation` |
| **Setup State** | Projection $P_1$ is stale. |
| **Input Payload** | 1. Call `POST /api/projections/{P1_id}/candidates` at time $T_1$ (Context resolved at $T_1$, generating candidate $C_1$).<br>2. Ingest matching Fragment $F_{late}$ at time $T_2$ ($T_2 > T_1$).<br>3. Approve Candidate $C_1$ at time $T_3$ ($T_3 > T_2$).<br>4. Call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` for all calls. |
| **Response Assertions** | Step 4: `GET /api/rotation` STILL lists Projection $P_1$ as stale because $F_{late}$ arrived after $T_1$. |
| **Database Assertions** | Candidate $C_1$ status is `"approved"` and active, but $P_1$ remains dynamically stale. |

---

### Test 6.5: Colour Tagging Staleness Trigger
- [ ] **Test 6.5: Colour Tagging Staleness Trigger**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Staleness Triggers → Colour Tagging |
| **Feature / Invariant** | Adding a Colour tag to an old fragment flags downstream syntheses matching that Colour as stale. Staleness compares the tag assignment time (`colour_fragment.created`), not the fragment's old ingest/event date. |
| **Endpoints** | Manual tagging surface per `api-updates.md` § 7 — currently `PATCH /api/colours/{id}` with `positiveExamples` → `GET /api/rotation` |
| **Setup State** | Projection $P_1$ consumes `colour_ids: [C1]`. $P_1$ is currently fresh. Fragment $F_1$ is old and previously untagged. |
| **Input Payload** | Tag $F_1$ with $C_1$. Call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Response lists Projection $P_1$ as stale. |
| **Database Assertions** | Dynamic calculation correctly uses the new `colour_fragment` creation timestamp to trigger staleness. |

---

### Test 6.6: Fragment Soft-Delete Staleness Trigger
- [ ] **Test 6.6: Fragment Soft-Delete Staleness Trigger**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Staleness Triggers → Fragment Deletion |
| **Feature / Invariant** | Soft-deleting a fragment flags dependent syntheses as stale. Staleness compares `fragment.deleted_at`, not the fragment's old ingest/event date. |
| **Endpoints** | `DELETE /api/collections/fragment/records/{id}` → `GET /api/rotation` |
| **Setup State** | Projection $P_1$ consumes Fragment $F_1$. $P_1$ is currently fresh. |
| **Input Payload** | Delete Fragment $F_1$. Call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Response lists Projection $P_1$ as stale. |
| **Database Assertions** | Dynamic calculation correctly uses `fragment.deleted_at` to trigger staleness. |

---

### Test 6.7: Upstream Window Materialisation Staleness Trigger
- [ ] **Test 6.7: Upstream Window Materialisation Staleness Trigger**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Staleness Triggers → Upstream Window Materialisation |
| **Feature / Invariant** | When a source Reflection materializes a new window, it shifts the `Last N` set of consuming Projections, immediately flagging them stale even if no snapshot has been published for the new window. |
| **Endpoints** | `GET /api/rotation` |
| **Setup State** | Projection $P_1$ consumes Reflection $R_1$ with `last_n: 1`. $R_1$ has window $W_1$ current and published. $P_1$ is fresh. |
| **Input Payload** | Advance time so $W_2$ materializes on $R_1$. Call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Response lists Projection $P_1$ as stale (because $W_2$ displaced $W_1$ in the `Last N` set). |
| **Database Assertions** | Dynamic calculation correctly identifies the materialization of $W_2$ as a staleness trigger for $P_1$. |

---

### Test 6.8: Manual Tag Removal Staleness Trigger
- [ ] **Test 6.8: Manual Tag Removal Staleness Trigger**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Staleness Triggers → Colour Tagging & Colour Backfills ("a Colour tag is manually added **or removed** on fragments") |
| **Feature / Invariant** | Removing a Colour tag from a fragment flags syntheses consuming that Colour as stale, exactly as adding one does. Removal flips `match_type` to `manual_negative` on the existing `colour_fragment` row in place, so the trigger must read `colour_fragment.updated` — `created` does not move and would make the removal invisible. Test 6.5 covers the add direction only. |
| **Endpoints** | `PATCH /api/colours/{id}` (with `negativeExamples`) → `GET /api/rotation` |
| **Setup State** | Projection $P_1$ consumes `colour_ids: [C1]`. Fragment $F_1$ is tagged with $C_1$ and included in $P_1$'s active snapshot's `resolved_context`. $P_1$ is currently fresh. |
| **Input Payload** | `<pre>PATCH /api/colours/{C1_id}<br>{<br>  "negativeExamples": ["F1_id"]<br>}</pre>`<br>Then call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Response lists Projection $P_1$ as stale. |
| **Database Assertions** | The $C_1 \to F_1$ row in `colour_fragment` has `match_type: "manual_negative"` and an `updated` timestamp later than its `created`. Regenerating $P_1$ produces a `resolved_context` excluding $F_1$. |

---

### Test 6.9: Specification Edit Staleness Trigger
- [ ] **Test 6.9: Specification Edit Staleness Trigger**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Staleness Triggers → Specification Edits & § Projection → Refinement & Versioning → Context Tweaking ("This flags the Projection stale") |
| **Feature / Invariant** | Modifying an entity's `Context Spec` flags it stale. Distinct from Test 5.5, which asserts only that pending candidates are retired obsolete — retirement and staleness are separate consequences of the same edit, and asserting one does not cover the other. |
| **Endpoints** | `PATCH /api/projections/{id}` → `GET /api/rotation` |
| **Setup State** | Projection $P_1$ consumes `fragment_types: ["email"]` with an active Approved Snapshot. `GET /api/rotation` reports $P_1$ as fresh. |
| **Input Payload** | `<pre>PATCH /api/projections/{P1_id}<br>{<br>  "current_context_spec": {<br>    "whole_scope": false,<br>    "fragment_types": ["note"]<br>  }<br>}</pre>`<br>Then call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Response lists Projection $P_1$ as stale, with no fragment having been ingested, tagged or deleted. |
| **Database Assertions** | $P_1$'s `context_spec_updated_at` is set to the patch time and is later than the active snapshot's `generation_timestamp` — the only signal by which this trigger is derivable. |

---

### Test 6.10: Colour Definition Update Does Not Trigger Staleness
- [ ] **Test 6.10: Colour Definition Update Does Not Trigger Staleness**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Staleness Triggers → Colour Tagging & Colour Backfills ("Updating an existing Colour definition does not re-evaluate past fragments or trigger staleness") |
| **Feature / Invariant** | Negative counterpart to Test 2.3. That test asserts no retroactive *reclassification*; this asserts no *staleness*. A naive implementation that treats `colour.updated` as an input timestamp would fail this while passing 2.3. |
| **Endpoints** | `PATCH /api/colours/{id}` → `GET /api/rotation` |
| **Setup State** | Projection $P_1$ consumes `colour_ids: [C1]` with an active Approved Snapshot. `GET /api/rotation` reports $P_1$ as fresh. |
| **Input Payload** | `<pre>PATCH /api/colours/{C1_id}<br>{<br>  "prompt": "Mentions Go or Rust"<br>}</pre>`<br>Then call `GET /api/rotation`. |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Projection $P_1$ is **still fresh** — the criteria change flags nothing. |
| **Database Assertions** | No new `colour_fragment` rows created; no existing row's `updated` timestamp moved. |

---

## Suite 7: Interactive Refinement Chat & Lens Lineage

### Test 7.1: Reflection Target Window Binding
- [ ] **Test 7.1: Reflection Target Window Binding**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Refinement Approval & Candidate Retirement Rules → Target Window |
| **Feature / Invariant** | Refinement Chat for a Reflection defaults to targeting the current materialized window unless an explicit historical window $t$ is specified. |
| **Endpoints** | `POST /api/reflections/{id}/refinements` |
| **Setup State** | Reflection $R_1$ exists with current materialized window $W_{curr}$. |
| **Input Payload** | `<pre>{<br>  "clientId": "conv-abc-123"<br>}</pre>`<br>*`target_window` deliberately omitted so the default applies. `clientId` is required by the handler.* |
| **HTTP Status** | `201 Created` |
| **Response Assertions** | Returns `{"refinementId": "..."}`. |
| **Database Assertions** | Fetch created `refine_refl_snapshot_conversation` record. Assert `target_window` matches $W_{curr}$'s boundaries. |

---

### Test 7.2: Lens Lineage & Parent Reference Tree
- [ ] **Test 7.2: Lens Lineage & Parent Reference Tree**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Internal Entities → Lens → Lineage & Evolution |
| **Feature / Invariant** | Approving a Refinement Chat preview distills a new child Lens containing a reference to `parent_lens_id`. |
| **Endpoints** | `POST /api/projections/{id}/refinements/{rid}/commit` |
| **Setup State** | Projection $P_1$ uses compiled Lens $L_1$. Open Refinement Chat $\rho_1$ (a `refine_proj_snapshot_conversation` record) holding Preview Snapshot $S_{preview}$. |
| **Input Payload** | `POST /api/projections/{P1_id}/refinements/{ρ1_id}/commit` with `<pre>{"updateLensAndContext": true}</pre>`<br>*`{rid}` is the **refinement conversation** id, not a snapshot id — `handleCommitRefinementGeneric` resolves it against `refine_proj_snapshot_conversation`. Lens distillation only runs when `updateLensAndContext` is set.* |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns committed snapshot ID. |
| **Database Assertions** | New record $L_2$ created in `lens` collection with `parent_lens_id == L1_id`. Projection $P_1$'s `current_lens_id` updated to $L_2$. |

---

### Test 7.3: Forward-Only Lens Scope Invariant
- [ ] **Test 7.3: Forward-Only Lens Scope Invariant**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Synthesized Views → Reflection → Refinement & Versioning → Forward-Only Lens Scope Rule |
| **Feature / Invariant** | Distilling a new Current Lens $L_2$ applies ONLY to future evaluations and its target window. It NEVER retroactively regenerates or invalidates historical window snapshots produced under prior Lenses. |
| **Endpoints** | `POST /api/reflections/{id}/refinements/{rid}/commit` |
| **Setup State** | Reflection $R_1$ has Approved Snapshots $S_1, S_2, S_3$ for Windows $W_1, W_2, W_3$ under Lens $L_1$. Refinement Chat $\rho_1$ has `target_window = W_3`, producing Preview Snapshot $S_{preview}$. |
| **Input Payload** | Commit refinement for $W_3$: `POST /api/reflections/{R1_id}/refinements/{ρ1_id}/commit` with `<pre>{"updateLensAndContext": true}</pre>`<br>*`{rid}` is the refinement conversation id — see Test 7.2.* |
| **HTTP Status** | `200 OK` |
| **Response Assertions** | Returns committed snapshot ID for $W_3$. |
| **Database Assertions** | Snapshot $S_3$ for $W_3$ is superseded by new Approved Snapshot $S_3'$ (produced under Lens $L_2$). Historical Snapshots $S_1$ ($W_1$) and $S_2$ ($W_2$) remain intact, active, and unchanged with `lens_id == L1_id`. |

---

## Suite 8: Deletion & Retention Operations

### Test 8.1: Fragment Deletion & Soft-Delete Tombstones
- [ ] **Test 8.1: Fragment Deletion & Soft-Delete Tombstones**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Deletion & Retention → Fragment deletion |
| **Feature / Invariant** | Deleting a fragment sets `deleted_at` timestamp. It is excluded from all future context resolution and flags matching syntheses stale, but remains as a tombstone in historical `resolved_context` records. |
| **Endpoints** | `DELETE /api/collections/fragment/records/{id}` |
| **Setup State** | Fragment $F_1$ is included in Approved Snapshot $S_1$'s `resolved_context`. Projection $P_1$ consumes $F_1$. |
| **Input Payload** | Step 1: Send `DELETE /api/collections/fragment/records/{F1_id}`.<br>Step 2: Generate candidate $S_2$ for Projection $P_1$. |
| **HTTP Status** | Step 1: `200 OK` or `204 No Content`.<br>Step 2: `200 OK`. |
| **Response Assertions** | Step 1: Fragment deleted response.<br>Step 2: Candidate generated response. |
| **Database Assertions** | Fragment $F_1$ record in `fragment` table has `deleted_at` set to non-null date. Historical Snapshot $S_1$'s `resolved_context` STILL contains $F_1$'s ID (marked/retained as tombstone). Projection $P_1$ is flagged stale. New Candidate Snapshot $S_2$'s `resolved_context` strictly EXCLUDES $F_1$. |

---

### Test 8.2: Downstream Dependency Protection Against Deletion
- [ ] **Test 8.2: Downstream Dependency Protection Against Deletion**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Deletion & Retention → Projection / Reflection deletion |
| **Feature / Invariant** | Deleting a Projection or Reflection that is consumed downstream by another synthesis must be prohibited until downstream dependencies are removed. |
| **Endpoints** | `DELETE /api/projections/{id}` |
| **Setup State** | Projection $P_1$ is consumed as a `source_projection` by Projection $P_2$. |
| **Input Payload** | `DELETE /api/projections/{P1_id}` |
| **HTTP Status** | `409 Conflict` or `400 Bad Request` |
| **Response Assertions** | Error states $P_1$ cannot be deleted while dependent synthesis $P_2$ references it. |
| **Database Assertions** | Projection $P_1$ remains intact in `projection` table. |

---

### Test 8.3: Lens Deletion Prohibition
- [ ] **Test 8.3: Lens Deletion Prohibition**

| Property | Detail |
|---|---|
| **Model Reference** | `model.md` § Deletion & Retention → Lens deletion |
| **Feature / Invariant** | Lenses are immutable version-tree nodes referenced by historical snapshots and cannot be deleted via API. **Already satisfied:** the `lens` collection sets both `DisableWriteOperations` and `DisableReadOperations`. This is a regression guard, not new work. |
| **Endpoints** | `DELETE /api/collections/lens/records/{id}` |
| **Setup State** | Lens $L_1$ exists. |
| **Input Payload** | `DELETE /api/collections/lens/records/{L1_id}` |
| **HTTP Status** | `405 Method Not Allowed` or `400 Bad Request` |
| **Response Assertions** | Error indicating delete operation on `lens` collection is disabled. |
| **Database Assertions** | Lens $L_1$ remains intact in `lens` table. |
