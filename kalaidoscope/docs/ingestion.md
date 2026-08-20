# Ingestion & Colour Tagging — Generated Audit Snapshot

> **Generated:** 2026-08-18, from source at commit `f272f1c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** How content becomes fragments — every entry path, the parsers, the writer — and what happens to a fragment at birth, including asynchronous colour tagging. Endpoint detail in `api.md` § 2/§ 8; fields in `schema.md`.

---

## 1. Entry paths

Three paths create fragments, all converging on the same collection and therefore the same birth hooks (§ 6):

1. **Sync single entry** — `POST /api/ingest`: one fragment per call, written inline.
2. **Async batch** — creating an `ingest` record (built-in collection endpoint) with file uploads: parsed in a background goroutine.
3. **Direct record create** — the `fragment` collection's own create endpoint (used e.g. for `chat`-type fragments captured from conversations): no parsing or dedupe, straight to the hooks.

## 2. Sync path

The message's `content` is required; `type` defaults to `"note"`; `source_time` is parsed as RFC3339 and **silently dropped** if unparseable. The writer (§ 5) is constructed per request with no budget and with dedupe only when `skip_duplicates` is set. `format`, `limit`, and `extensions` are accepted in the body but unused on this path.

## 3. Async batch path

Creating an `ingest` record captures its uploads and options in the create hook, forces `status: "pending"`, and — after the record saves — processes the files in one background goroutine:

- One writer serves the whole record: the `limit` budget and the dedupe set span **all** files in it.
- Each file is routed by `format` (or per-file inference, § 4) and parsed into fragments fed through the writer.
- Processing **stops at the first file that errors**; earlier files' fragments remain. Reaching the budget or context cancellation is normal completion.
- The record is then updated: `ingested` = fragments written, `status` `"done"` — or `"error"` with the message. Nothing retries a failed record.

## 4. Parsers

Format inference from the file name: `.mbox`/`.eml` → mbox, `.zip` → zip, `.docx` → docx, anything else → text. An explicit `format` overrides inference for top-level files only.

| Parser | Behaviour |
|---|---|
| **text** | The whole payload becomes one `"note"` fragment; `source` = file name (or `"imported text"`). No `SourceTime`. |
| **mbox** | Splits on `From `-prefixed envelope lines (also accepts a single `.eml`, which has none); `>From `-quoting is unescaped. Per message: RFC 2047 headers decoded; body extracted preferring the first `text/plain` part of a multipart (else the first non-empty part), with quoted-printable and base64 transfer encodings decoded; non-text single parts (attachments) are dropped. The fragment is `"email"`-typed with `From/To/Subject/Date` headers re-rendered above the body, `source` = `From · Subject` (fallback `"imported email"`), and `SourceTime` from the `Date` header. An unparseable message is kept as raw text rather than dropped. |
| **zip** | Iterates entries (directories skipped), filtered by the extensions list (default `.txt`, `.md`, `.docx` — note this default excludes nested `.eml`/`.mbox`), and re-enters the parser per entry with per-entry format inference. Unreadable entries are logged and skipped; a parse failure inside an entry aborts the file. |
| **docx** | Extracts `word/document.xml` text (tabs, breaks, and paragraph boundaries preserved as whitespace; everything else stripped) into one `"note"` fragment; a file without that entry is an error. |

Parsers emit only `"email"` and `"note"` types; the `fragment.type` select also allows `whatsapp`, `sms`, `chat`, which arrive only via the sync or direct paths.

## 5. The writer

Shared by both parsing paths. Per fragment: content is trimmed; empty content is silently skipped. With dedupe on, the SHA-256 of the trimmed content is checked against a set preloaded from **all existing fragments — soft-deleted included** — plus everything written earlier by this writer; an exact match is silently skipped (re-ingesting a deleted fragment therefore does not resurrect it). A positive `limit` caps records written; the budget check happens before each write. `source_time` is set only when the parser supplied one — otherwise the birth hook stamps it. Each save is an ordinary record save and fires the hooks below.

## 6. Birth hooks

Every fragment creation, from any path, passes through two hooks: `source_time` defaults to now when unset; and after the save commits, one colour-evaluation task per **existing colour** is enqueued for the new fragment.

## 7. Colour tagging

A single in-memory queue (capacity 1000, drained by one worker goroutine, not persisted across restarts) receives tasks from two producers: new fragments (one task per colour, § 6) and retroactive backfill on colour creation (one task per fragment, newest 10,000, soft-deleted included). Per task the worker:

1. Skips if **any** `colour_fragment` link already exists for the pair — including a `manual_negative` one, which therefore permanently blocks LLM evaluation of that pair.
2. Builds the evaluation prompt from the colour's `criteria` plus up to 20 `manual_positive` and 20 `manual_negative` example fragments.
3. Calls the colour-role model (workspace-level; per-entity overrides never apply to colour work). Preempted calls retry in place at idle priority.
4. On output containing `YES` (case-insensitive), writes the link with `match_type` `"llm_matched_tag_on_input"` (new-fragment task) or `"llm_matched_backfill"` (backfill task), recording the deciding model. Any other output writes nothing — a "no" leaves no record and the § 7.1 skip never sees it, so the pair is re-evaluated if it is ever enqueued again.

Auth/quota provider failures are recorded durably on the colour (`last_provider_error_kind`, cleared on the next success); transient failures drop the task.

Manual tagging (positive/negative examples via the colour update endpoint) upserts the pair's single link row, overwriting any prior classification; colour criteria edits never re-evaluate existing links.
