# Prompt Inventory — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** Every piece of model-facing text the binary sends, as an inventory: which flow sends it, under which role, what is interpolated into it, and which shared blocks it is built from. The prompt text itself is **not** reproduced here — it is the code, in `internal/prompts/`. Also the parsers that read model replies back, since they define what a prompt must elicit. Tool schemas (parameter shapes) are stated where the flow doc does not.

**Completeness anchor.** All model-facing text lives in package `internal/prompts` (6 non-test files: `prompts.go`, `annotate.go`, `consolidate.go`, `discover.go`, `mapping.go`, `chat_summaries.go`); call sites only assemble. Tool definitions (`llm.Tool` literals) live in `internal/handlers/refinement_chat.go` (2), `internal/discover/loop.go` (5 shared), `internal/discover/colours.go` (1), `internal/discover/projections.go` (1), `internal/discover/reflections.go` (2).

---

## 1. Shared blocks

| Block | Used by | Content role |
|---|---|---|
| `ProductBrief` | chat, refinement system prompts | What the product is; phrased so a role line can precede it |
| `ContextLegend` | chat, refinement | Explains the `--- … ---` document blocks (fragments vs snapshot blocks), delta notices, and forbids echoing raw ids |
| `MentionLegend` | chat, refinement | Explains the expanded `@"Label" (…)` reference forms and how each joins to a block |
| `GroundingRules` | chat, refinement | Reason from documents; outside facts only on request; admit gaps |
| `ChatSummariesLegend` | chat (summaries) | Overrides the id rule: ids exist for tool calls; describes rows, stubs, and the two read tools |
| `FragmentBlock(kind, source, id, content)` | every hydration, colour judge target/examples, annotate | `--- <kind> from <source> (ID: <id>) ---` |
| `ProjectionSnapshotBlock(name, id, output)` / `ReflectionSnapshotBlock` | hydration | `--- projection "<name>" (ID: <snapshot id>) ---` |
| `AddedNotice` / `SummariesAddedNotice` / `RemovedNotice` / `RemovedIDLine(kind, id)` | transcript delta hydration | Context change notices |
| `WindowNotice(start, end)` | refinement transcript | Announces the active time window on the delta turn |
| `LensEcho(toolName, lens)` | refinement transcript flattening | `[You called update_lens, setting the lens to:]` — the only tool part echoed to a model |
| `FragmentMention(label, id)`, `ProjectionMention`, `ReflectionMention`, `ColourMention(label)`, `TypeMention(type)` | `ExpandMentions` | Fragment joins by id; projection/reflection by name; colour/type name a group |
| `BuildPrefix(sourceBlock, start, end)` | apply, delta/merge | `Source Documents[ from … to …]:` + sources; `(no source documents provided)` when empty |
| `DiscoverEchoToolCalls(names)` | discover loop, summaries chat, transcript replay | `[You called: a, b]` appended to an assistant turn |
| `ValidationPing` | config validation | The literal `ping` |

## 2. Per-flow inventory

| Prompt / text | Sent by | Role | Interpolates | Reply parsed by |
|---|---|---|---|---|
| `ChatSystemPrompt` | chat turn (system) | chat | — (ProductBrief + ContextLegend + MentionLegend + GroundingRules) | free text |
| `ChatSummariesSystemPrompt(digest)` | chat turn in summaries mode (system) | chat | `ChatSystemPrompt` + `ChatSummariesLegend` + `SummariesMapDigest(map, floor 2)` | free text + tool calls |
| `SummariesMapDigest(doc, floor)` | inside the above | chat | narrative; things with ≥ floor fragments, heaviest first (`id · name · kind · fragments · span · blurb`); relationships | — |
| `SummaryRowLine(row, names)` / `SummaryStubLine(…)` / `SummarySnippet` | summaries-mode delta hydration | chat | annotation row fields, resolved thing names; 200-rune snippet for unannotated | — |
| `ChatReadBudgetExhausted(limit)` | chat read tool result | chat | 12 per turn | — |
| `RefinementSystemPrompt` | refinement turn (system) | refinement | shared blocks + epistemic position, hard lens rules (data-agnostic, no pinned counts, standalone), `update_lens`/`suggest_name` protocol, output-reference questioning, naming rules | tool calls `update_lens{lens, suggested_name}`, `suggest_name{name}` |
| `ApplyPrompt(lens, sources, start, end)` | refinement apply leg; snapshot generation | snapshot | `BuildPrefix` + `Instruction:` + lens + `Output:` | trimmed text |
| `SnapshotDeltaPrompt(previous)` | snapshot regeneration, turn 2 | snapshot | previously approved output | trimmed equality with `SnapshotNoChanges` (`NO CHANGES`), else bullets |
| `SnapshotMergePrompt()` | snapshot regeneration, turn 3 | snapshot | — | trimmed text |
| `ColourEvalPrompt(prompt, positive, negative, target)` | colour worker; colour preview | colour | `ColourEvalInstruction` + criteria + optional example blocks + one target `FragmentBlock` | `ParseYesNo` — first alphabetic word equals `yes` (case-insensitive) |
| `AnnotatePrompt(doc, fragmentBlock)` | annotate worker | annotate | map block (things with ≥ 2 fragments, relationships among them, narrative; or `annotateEmptyMap`) + the fragment; asks for JSON `{title, summary, things[], decisions[], questions[], conclusions[]}` | `ParseAnnotateReply`: first `{`…last `}` containing key `summary`; non-empty summary required; things split into `{ref}` or `{name, kind, note}` with kind normalised |
| `MapJSONRetryNudge` | annotate, on unparseable reply (one retry) | annotate | — | as above |
| `ConsolidatePrompt(doc, rows)` | map consolidation | map | current map as JSON (id, name, aliases, kind, blurb, relationships, narrative) or a first-run line; every annotation row (`--- id · date · title ---`, summary, `things:` citations); asks for the complete new map JSON | `ParseConsolidateReply`: JSON object containing key `things` |
| `ConsolidateJSONRetryNudge` | consolidation, on unparseable reply (one retry) | map | — | as above |
| `DiscoverColoursSystem` / `DiscoverColoursInitial(doc, floor 5)` | discover colours run | map | narrative, things ≥ floor heaviest first, relationships, guidance; then `DiscoverExistingBlock`, `DiscoverCoverageBlock` on the same user turn | tool calls |
| `DiscoverProjectionsSystem` / `DiscoverProjectionsInitial(doc, floor 5)` | discover projections run | map | as above with projection guidance and examples | tool calls |
| `DiscoverReflectionsSystem` / `DiscoverReflectionsInitial(doc, floor 5, rhythms)` | discover reflections run | map | as above plus the month-grain `DiscoverRhythmsBlock` | tool calls |
| `DiscoverThingCard(thing, rels, cited, timeline, sample)` | `read_thing` result (discover and chat) | map / chat | header, blurb, count and span, relationships, month timeline, up to 30 sampled rows | — |
| `DiscoverRhythmsBlock`, `DiscoverRhythmCard` | reflections initial turn; `rhythms` tool result | map | singles and pairs: things, totals, active/span buckets, first/last/onset, `ubiquitous` flag, up to 12 sampled buckets | — |
| `DiscoverExistingLine`, `DiscoverExistingNone`, `DiscoverColourDescription` | `list_existing` result | map | kind, name, id, note (`proposed by this run` / `proposed by an earlier run, not yet opened`), description, fragment count | — |
| `DiscoverCoverage(hit, total, gaps)` | `coverage` result | map | percentage inside scopes; up to 10 least-covered things | — |
| `DiscoverProposed`, `DiscoverProposedReflection`, `DiscoverCreatedColour` | tool results on success | map | name, id, fragment count, cadence/start | — |
| `DiscoverRejected(reason)` + reason constants (`DiscoverBadArgs`, `DiscoverNameAndMessageRequired`, `DiscoverScopeRequired`, `DiscoverReflectionScopeRequired`, `DiscoverColourNameRequired`, `DiscoverColourThingsRequired`, `DiscoverNoThing`, `DiscoverNoFragment`, `DiscoverNoRecord`, `DiscoverUnknownTool`, `DiscoverUnknownCadence`, `DiscoverBadStartTime`, `DiscoverStartInFuture`, `DiscoverTooManyWindows`, `DiscoverUbiquitousThing`, `DiscoverTooManyThings`, `DiscoverReadBudgetExhausted`) | tool results on rejection | map | the offending value | — |

## 3. Tool definitions

| Tool | Advertised to | Parameters | Defined in |
|---|---|---|---|
| `update_lens` | refinement | `lens` (required), `suggested_name` | `handlers/refinement_chat.go` |
| `suggest_name` | refinement | `name` (required) | `handlers/refinement_chat.go` |
| `apply_result` | **no model** — fabricated on the wire only | `output` | `handlers/refinement_chat.go` |
| `read_thing` | discover (`ids[]`), chat summaries (`ids[]`, chat-specific description) | `ids` (required) | `discover/loop.go`, `discover/reads.go` |
| `read_fragment` | discover (`id`), chat summaries (`ids[]`) | `id` / `ids` (required) | `discover/loop.go`, `discover/reads.go` |
| `list_existing` | discover | none | `discover/loop.go` |
| `coverage` | discover | none | `discover/loop.go` |
| `finish` | discover | `summary` (required) | `discover/loop.go` |
| `create_colour` | discover colours | `name`, `thingIds[]` (both required) | `discover/colours.go` |
| `propose_projection` | discover projections | `name`, `message` (required), `thingIds[]`, `fragmentIds[]`, `colourIds[]`, `sourceProjectionIds[]` | `discover/projections.go` |
| `rhythms` | discover reflections | `grain` ∈ {week, month} (required), `thingIds[]` | `discover/reflections.go` |
| `propose_reflection` | discover reflections | `name`, `message`, `cadence` ∈ {daily, weekly, monthly, quarterly}, `startTime` (all required), `thingIds[]`, `fragmentIds[]`, `colourIds[]` | `discover/reflections.go` |

Every tool description string is a `prompts` constant; the handler files hold only the JSON schema skeletons.

## 4. Wire identifiers that are also prompt text

`update_lens`, `suggest_name`, `apply_result`, `read_thing`, `read_fragment` are simultaneously tool names the model sees (or, for `apply_result`, never sees), persisted part types (`tool-<name>`), and strings the client reads. Renaming any of them changes stored transcripts and client behaviour, not only a prompt.
