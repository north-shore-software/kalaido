# Ingestion — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** How content becomes fragments — every entry path, the parsers, the writer — what happens to a fragment at birth and on delete, and the post-import pipeline that hands off to the map and discover workers. Colour membership is in `colours.md`; the map is in `map.md`; endpoint detail in `api.md` § 2; fields in `schema.md` § 2.

**Completeness anchor.** 3 entry paths converging on the `fragment` collection; 3 `fragment` hooks and 1 `ingest` hook (`server/server.go` `RegisterTriggers`, `internal/ingest/batch.go`); 4 parser formats (`zip`, `mbox`, `docx`, `text`).

---

## 1. Entry paths

1. **Sync single entry** — `POST /api/ingest`: one fragment per call, written inline, `origin = "sync"`.
2. **Async batch** — creating an `ingest` record (the collection's built-in create endpoint) with file uploads: parsed in a background goroutine, `origin = "import"`.
3. **Direct record create** — the `fragment` collection's own create endpoint (e.g. `chat`-type fragments captured from conversations): no parsing, no dedupe, `origin` defaults to `"app"` in the birth hook.

## 2. Sync path

Body (`api.IngestMessage`, **snake_case** for multi-word fields): `content` required (400 `content required`); `type` trimmed, default `"note"`; `source`; `source_time` parsed as RFC3339 and **silently dropped** if unparseable; `skip_duplicates` enables dedupe. `format`, `limit`, `extensions` are accepted and unused on this path. Response `200 {fragmentId, ingested}`; a deduped entry returns `fragmentId: ""`, `ingested: 0` with 200.

## 3. Async batch path

`OnRecordCreate("ingest")` runs **before** the record is saved: it reads every unsaved upload from the `file` field into memory (a read failure is logged and the remaining files still processed), reads `format`, `limit`, `extensions` (comma-separated, lower-cased, `.`-prefixed), `skip_duplicates`, `organize_after`, sets `status = "pending"`, lets the save proceed, then starts `processIngestRecord` in a goroutine.

The goroutine parses each file in order with one writer per file (so `limit` applies **per file** and dedupe state is rebuilt per file). The first file error stops processing of later files. It then reloads the `ingest` row and sets `ingested` (total fragments written), `status = "done"` or `"error"` + `error`. A reload failure leaves the row `pending` forever. Then:

- `organize_after` and an error: `pipeline = "error"`, `pipeline_error`, and `mapping.SignalAuto()`.
- `organize_after` and success: the pipeline (§ 4).
- otherwise `mapping.SignalAuto()` — a no-op while auto-map is disabled (`boot-and-workers.md` § 2).

## 4. The post-import pipeline

`startPipeline` sets `pipeline = "mapping"`, registers a follow-up on the mapping worker, and signals it (`mapping.Signal()`, unconditional). When that drain ends: on error `pipeline = "error"` + `pipeline_error`; otherwise `pipeline = "organizing"`, a follow-up is registered on the discover worker, and the three discover kinds are signalled (`colours`, `projections`, `reflections`). When that drain ends: `pipeline = "done"` or `"error"`. Because follow-ups are taken at the *start* of a drain (`boot-and-workers.md` § 2), a pipeline registered while a drain is already running is reported by the drain after it. `pipeline_error` is never cleared on a later success.

## 5. Parsers

`parsers.Parse(src, exts, emit)` dispatches on `Format`, else infers from the file name's extension: `.mbox`, `.eml` → `mbox`; `.zip` → `zip`; `.docx` → `docx`; anything else → `text`.

| Format | Behaviour |
|---|---|
| `text` | One `note` fragment with the whole payload; source = file name or `imported text`. |
| `docx` | Extracts `word/document.xml` text (`<t>` runs, tabs, breaks, paragraph newlines); one `note` fragment; source = file name or `imported document`. Invalid archive or missing part → error. |
| `mbox` | Splits on `From ` envelope lines (`>From ` unquoted); each message is parsed with `net/mail`; unparseable messages become a fragment holding the raw text. Body: first `text/plain` part of a multipart, else the first non-empty part, else the single text part; quoted-printable and base64 decoded; non-text single parts skipped. Content = `From`/`To`/`Subject`/`Date` header lines + blank line + body. Source = `from · subject`, else `imported email`. `SourceTime` = the `Date` header. Type `email`. |
| `zip` | Every non-directory entry whose lower-cased name ends with one of `exts` (default `.txt`, `.md`, `.docx` when none given) is recursively parsed with format inferred from the entry name. An entry that cannot be opened is logged and skipped. |

`limit` stops parsing through a sentinel error once the writer is full; that stop is not reported as an error.

## 6. The writer

`newWriter(limit, skipDuplicates)`: with dedupe on, it preloads the SHA-256 of **every** existing fragment's content (deleted ones included) into memory; a preload failure is logged and dedupe proceeds with an empty set. `addAt`: trims content; empty → skipped silently; duplicate hash → skipped silently; otherwise a `fragment` is saved with `type`, `origin`, `source`, `content`, and `source_time` when non-zero. Fragments are saved one at a time, each firing the birth hooks.

## 7. Birth and delete hooks

- `OnRecordCreate("fragment")` (before save): `source_time` defaults to now when zero; `origin` defaults to `"app"` when empty.
- `OnRecordAfterCreateSuccess("fragment")`: `colour.Signal()` (the prompt worker will judge the new fragment against every prompt colour, `colours.md` § 4) and `mapping.SignalAuto()` (no-op under the flag). No annotation or thing matching happens at birth.
- `OnRecordDeleteRequest("fragment")` — the collection's built-in delete endpoint: instead of deleting, sets `deleted_at = now` (if unset) and saves, then returns **204**. The row is never removed. Consequences: `colour_fragment` and `fragment_annotation` rows for it remain (no cascade fires); context resolution excludes it (`context.md` § 2); the map's pending set and counters exclude it, but its annotation row still participates in consolidation and summaries rows with an empty date (`map.md` § 4); the dedupe preload still sees its content. Programmatic `app.Delete` of a fragment (not used by any code path) would hard-delete and cascade.
