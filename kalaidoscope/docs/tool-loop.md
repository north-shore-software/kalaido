# Tool Loop — Generated Audit Snapshot

> **Generated:** 2026-09-23, from source at commit `bdd0b9a`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The shared model tool loop (`internal/agent/`) and the map reader built on it (`internal/mapreader/`): the loop's objects, its rounds and their cap, how tool calls are dispatched, the four stop rules (including stop-before-last-dispatch), how the model's reply and tool calls are echoed back into the transcript and how tool results are returned to it, the callbacks a consumer may hook, the argument helpers that read a tool call's JSON, the tool-schema helpers that build `llm.Tool` definitions, and the map reader as the shared read surface over the map — its two read tools, the fragment-read budget, and the two ways it is constructed. The read-only accessors it loads through (`internal/sourcedata/`) and the things-document type it resolves against (`internal/mapdoc/`) are described only as far as saying what each read returns. The two consumers — the discover run and the explore summaries turn — are covered here only as to what they bind and how they use the result; the discover flows, their other tools and the run record are in `discover.md` § 3, and the explore summaries turn (seeding, stream, read persistence and replay) is in `explore.md` § 5. Tool descriptions and other model-facing text are inventoried in `prompts.md` § 3, never reproduced here. The map document and annotation rows themselves are in `map.md` § 1 and § 4; the collections they live in are in `schema.md` § 2.19 and § 2.20; the fragment collection is in `schema.md` § 2.1.

**Completeness anchor.** `internal/agent/` exports exactly five types (`Turn`, `Runner`, `HandlerFunc`, `BoundTool`, `Registry`), five methods (`Runner.Run`, `Registry.Register`, `Registry.Tools`, `Registry.Dispatch`, `Registry.Dispatcher`) and ten functions (`IDTool`, `IDsTool`, `EmptyTool`, `StringArraySchema`, `IDArg`, `IDsArg`, `StrArg`, `ToolNames`, `FormatAssistantEcho`, `FormatToolResults`); `Runner` has exactly seven fields (`MaxRounds`, `StopBeforeLastDispatch`, `Generate`, `Dispatch`, `OnToolDispatched`, `PromptGuard`, `OnRoundEnd`). `internal/mapreader/` exports exactly two constants (`ThingRowSample`, `ChatFragmentReads`), one type (`Reader`), three functions (`New`, `NewChatReader`, `ChatReadTools`) and six methods (`Reader.Registry`, `Reader.Reads`, `Reader.ReadThings`, `Reader.ReadThing`, `Reader.ReadFragment`, `Reader.ReadFragments`); `ChatReadTools` declares exactly two tools, `read_thing` and `read_fragment`. Every symbol above is described in the section named beside it below. Exactly two sites construct an `agent.Runner` (`internal/discover/loop.go`, `internal/explore/summaries.go`) and exactly two construct a `Reader` (`internal/discover/context.go` via `New`, `internal/explore/summaries.go` via `NewChatReader`) — all four in § 8.

---

## 1. Objects

The loop is built on three wire types from `llm/provider.go`: `llm.Message` (`role`, `content` — both strings; there is no structured tool-call role, so tool traffic is carried as text, § 3), `llm.Tool` (`name`, `description`, `parameters` as raw JSON schema) and `llm.ToolCall` (`id`, `name`, `args` as raw JSON).

`agent.Turn` is the model's output in one round: `Text` (the reply) and `ToolCalls` (`[]llm.ToolCall`, possibly empty).

`agent.Runner` is a plain struct of one setting, one flag and five function fields; a consumer fills it and calls `Run` (§ 2). `MaxRounds` is the cap on model calls and must be greater than zero. `StopBeforeLastDispatch` is the flag described in § 2.3. `Generate(ctx, msgs, round)` produces the next `Turn` from the transcript (`round` is zero-based). `Dispatch(ctx, call)` executes one tool call and returns `(output, done, err)`; `done=true` asks the loop to finish after the current round. `OnToolDispatched(call, output)` is called after each executed call. `PromptGuard(msgs)` is consulted after tool results are appended; a non-nil error aborts the loop. `OnRoundEnd(ctx, round)` runs at the end of a round that ended normally.

`agent.HandlerFunc` has the same signature as `Runner.Dispatch`. `agent.BoundTool` pairs one `llm.Tool` with a `HandlerFunc`; `agent.Registry` is a slice of `BoundTool` (§ 4).

## 2. The loop (`Runner.Run`)

`Run(ctx, msgs *[]llm.Message) error` mutates the caller's transcript in place; the caller owns the slice and sees every appended message after `Run` returns, whether it returned nil or an error.

### 2.1 Preconditions

`Run` returns an error without calling anything when `MaxRounds <= 0` (`agent: MaxRounds must be greater than 0`) or when `Generate` is nil (`agent: Generate function is required`). `Dispatch` and every callback may be nil (§ 2.4).

### 2.2 A round

For `round` from `0` to `MaxRounds-1`:

1. `Generate(ctx, *msgs, round)` is called. An error is returned as-is and ends the loop; nothing is appended and `OnRoundEnd` does not run.
2. The turn is echoed onto the transcript as one assistant message: `FormatAssistantEcho(turn.Text, turn.ToolCalls)` (§ 3). This happens before any stop rule is evaluated, so a turn with no tool calls still lands on the transcript.
3. If the turn has no tool calls: `OnRoundEnd(ctx, round)` runs (when set) and `Run` returns nil.
4. If `StopBeforeLastDispatch` is set and `round+1 >= MaxRounds`: `OnRoundEnd` runs and `Run` returns nil. The tool calls in the echo are never dispatched.
5. Otherwise each tool call is dispatched in the order the model emitted it. When `Dispatch` is nil the output is the empty string and nothing is executed. A `Dispatch` error is returned as-is and ends the loop mid-round: earlier calls in the round have already executed, later ones are not, `OnRoundEnd` does not run and no results are appended. `done=true` from any call sets a `finished` flag but does not stop the remaining calls of the round from being dispatched. After each call `OnToolDispatched(call, output)` runs (when set), including for calls that `Dispatch` answered with `done=true` and for calls that fell through to an empty output because `Dispatch` was nil.
6. `OnRoundEnd(ctx, round)` runs (when set).
7. If `finished` is set, or `round+1 >= MaxRounds`, `Run` returns nil. The round's results are discarded: they were passed to `OnToolDispatched` but are not appended to the transcript.
8. Otherwise the results are appended as one user message, `FormatToolResults(results)` (§ 3), and `PromptGuard(*msgs)` is consulted (when set); a non-nil error is returned as-is and ends the loop with the results already on the transcript.

The `for` loop's own exit (returning nil after `MaxRounds` iterations) is unreachable: the final round always returns at step 3, 4 or 7 before step 8.

### 2.3 Stop rules

The loop ends, in order of precedence within a round:

| Rule | Where | Transcript state at exit | `OnRoundEnd` |
|---|---|---|---|
| `Generate` returns an error | step 1 | unchanged this round | not run |
| The turn has no tool calls | step 3 | echo appended | run |
| `StopBeforeLastDispatch` on the final round | step 4 | echo appended; calls not executed | run |
| `Dispatch` returns an error | step 5 | echo appended; results not appended | not run |
| A call returned `done=true`, or this was the final round | step 7 | echo appended; results not appended | run |
| `PromptGuard` returns an error | step 8 | echo and results appended | run (before the guard) |

`StopBeforeLastDispatch` exists for the interactive consumer: on the last allowed round a dispatched result could never be answered by the model, so the calls are dropped and the round's text is the final answer. Without the flag the last round's calls are executed (side effects included) and their outputs go only to `OnToolDispatched`.

`ctx` is passed through to `Generate` and `Dispatch`; the loop itself never checks `ctx.Err()`, so cancellation ends the loop only through an error returned by one of those.

### 2.4 Callbacks

All five function fields other than `Generate` are optional. A nil `Dispatch` makes every tool call answer with an empty output and `done=false`; a nil `OnToolDispatched`, `PromptGuard` or `OnRoundEnd` is skipped. `OnRoundEnd` receives the zero-based round index; it is the checkpoint hook both consumers use (§ 8).

## 3. Transcript echo

The provider transcript carries only `role`/`content` pairs, so tool traffic is written into text:

- `ToolNames(calls)` returns the call names in order.
- `FormatAssistantEcho(reply, calls)` returns an assistant message whose content is `reply` followed by `prompts.DiscoverEchoToolCalls(ToolNames(calls))`. With no calls the suffix is empty and the content is exactly `reply`. With calls the suffix is a blank line then `[You called: name1, name2]` — names only; the call ids and arguments are not echoed.
- `FormatToolResults(results)` returns a user message whose content is the outputs joined by a blank line (`"\n\n"`). Results are not labelled with the call they answer; the model relies on order and on each tool's own output format (for the map reader, each card and block names its id, § 7).

Both functions are also what `Run` uses (§ 2.2 steps 2 and 8); consumers that persist their own transcript record the same shapes.

## 4. Dispatch: the registry

`Registry` is a `[]BoundTool`.

- `Register(tool, handler)` appends one binding (pointer receiver).
- `Tools()` returns the `llm.Tool` of every binding in registry order, handler or not; this is the list a consumer advertises to the model.
- `Dispatch(ctx, call)` walks the registry in order and executes the first binding whose `Tool.Name` equals `call.Name` **and** whose `Handler` is non-nil, returning `(output, done, handled=true, err)`. A binding with a nil handler is skipped as if absent, so a tool can be declared (visible in `Tools()`) without being handled here. No match returns `("", false, false, nil)` — not an error.
- `Dispatcher(fallback)` adapts the registry to the `Runner.Dispatch` signature: handled calls return the handler's result; unhandled calls go to `fallback` when given, else answer `("", false, nil)` silently.

Because `Dispatch` returns on the first match, a later binding with the same name is shadowed; nothing detects duplicates.

## 5. Argument helpers

Each helper unmarshals `call.Args` independently; none returns an error.

| Helper | Reads | Returns | On bad or missing input |
|---|---|---|---|
| `IDArg(call)` | `id` (string) | the value, whitespace-trimmed | `""` (unmarshal errors ignored) |
| `IDsArg(call)` | `ids` (array of string), else `id` | `ids` as given (elements not trimmed); when `ids` is empty and `id` is non-blank, a one-element slice holding the trimmed `id` | `nil` / empty slice (unmarshal errors ignored) |
| `StrArg(call, key)` | `key` (any JSON value) | the value if it is a string, whitespace-trimmed | `""` when the args are not a JSON object, the key is absent, or the value is not a string |

## 6. Tool-schema helpers

These build the `parameters` JSON of an `llm.Tool` by string concatenation; only the description arguments are JSON-quoted (`strconv.Quote`), the `name` and `param` arguments are inserted verbatim.

| Helper | Schema produced |
|---|---|
| `IDTool(name, description, param, paramDescription)` | object with one required string property named `param` |
| `IDsTool(name, description, paramDescription)` | object with one required property `ids`: array of string |
| `EmptyTool(name, description)` | object with no properties |
| `StringArraySchema(description)` | not a tool: the JSON fragment for one array-of-string property, for consumers composing a larger schema by hand |

Where each consumer uses which helper is in § 8; the descriptions passed in are inventoried in `prompts.md` § 3.

## 7. The map reader

`mapreader.Reader` is one loaded view of the map plus a fragment-read budget, built once per run or per turn and then read only.

### 7.1 Construction and what is loaded

`New(app, budget)` calls `sourcedata.LoadMapIndex(app)` and copies its four parts onto the exported fields:

- `Doc` — the `kalaidoscope_map` singleton's `body` parsed by `mapdoc.Parse` into a `mapdoc.Document` (`things`, `relationships`, `narrative`). When no map row exists, or the body is blank, `{}`, `null`, not a JSON object, lacks a `things` key or does not unmarshal, the document is empty; the parse's failure flag is discarded by the loader.
- `Version` — the row's `version`, or `0` when there is no row. The reader stores it and never reads it.
- `Rows` — every `fragment_annotation` row (no liveness filter on the annotation side) as a `sourcedata.Row` (`= prompts.AnnotationRow`: `FragmentID`, `Date`, `Title`, `Summary`, `Things`), with `Date` taken from `sourcedata.FragmentDates` — the `occurred_at` of live (`deleted_at = ''`) fragments formatted `YYYY-MM-DD`; a row whose fragment is deleted or has no `occurred_at` gets `""`. Rows are sorted by `Date` ascending (stable, so `""` dates sort first, then by `created` load order).
- `ByThing` — `sourcedata.IndexRows`: for each row and each of its `things` citations, the citation's `ref` (falling back to `name`) is resolved through `Document.Resolve` (exact `id`, then normalised name or alias); each resolved thing id maps to the ascending list of row indexes citing it, one entry per row even when a row cites the same thing twice. Citations that resolve to nothing are dropped.

`App` is also kept for the fragment reads. The private `budget` is the argument; `reads` starts at zero; the exhaustion message is `prompts.DiscoverReadBudgetExhausted` (the "per run" wording).

`NewChatReader(app)` is `New(app, ChatFragmentReads)` (`ChatFragmentReads = 12`) with the exhaustion message swapped for `prompts.ChatReadBudgetExhausted` (the "per turn" wording). Those are the two constructors; nothing else sets the budget or the message.

`Reads()` returns how many fragment reads have succeeded so far (§ 7.4).

### 7.2 The read tools

`ChatReadTools()` declares two tools, both via `IDsTool`, with the chat descriptions:

| Tool | Name constant | Parameter | Handler |
|---|---|---|---|
| `read_thing` | `prompts.ReadThingToolName` | `ids` (required, array of string), described by `prompts.ReadThingParamDescription` | `ReadThings(IDsArg(call))` |
| `read_fragment` | `prompts.ReadFragmentToolName` | `ids` (required, array of string), described by `prompts.ChatReadFragmentParamDescription` | `ReadFragments(ctx, IDsArg(call))` |

`Reader.Registry()` binds exactly these two, in this order, by index into `ChatReadTools()`; both handlers always return `done=false` and a nil error, so a read never ends the loop and never fails it. The discover consumer declares the same two tool names with its own descriptions and, for `read_fragment`, a different parameter shape (§ 8.1); the reader's methods accept both because `ReadThings`/`ReadFragments` take slices and `ReadFragment` takes one id.

### 7.3 `read_thing`

`ReadThings(refs)`: when more than `prompts.DiscoverReadThingLimit` (`10`) refs are given, the list is truncated to the first ten and `prompts.DiscoverTooManyThings(10)` is emitted as the first line. Each ref is trimmed and answered by `ReadThing`; the answers are joined by single newlines. An empty `refs` produces an empty string.

`ReadThing(ref)` resolves `ref` through `Doc.Resolve` (exact id, then normalised name or alias). No match returns `prompts.DiscoverNoThing(ref)`. Otherwise it returns `prompts.DiscoverThingCard` built from:

- the thing's `id`, `name`, `kind`, `aliases`, `blurb`, and `first_seen`/`last_seen` when `first_seen` is set;
- every `relationships` entry whose `from` or `to` is the thing, rendered by `prompts.DiscoverRelationshipLine` with both ends' names and ids; an entry whose other end does not `Find` in the document is skipped;
- the citation count — `len(ByThing[id])`, i.e. annotation rows citing the thing, not the document's own `fragments` field;
- a month timeline: each citing row's `Date` truncated to `YYYY-MM`, counted; a date shorter than seven characters (including `""`) is counted under `prompts.DiscoverUndated`;
- a sample of at most `ThingRowSample` (`30`) citing rows chosen by `pbutil.SampleEvenly` (every row when there are thirty or fewer, otherwise indexes `k*len/30` for `k` in `0..29`), each as `Date`, `Title`, `Summary` and `FragmentID`.

When the citation count is zero the card ends after the relationships with the no-citations line and carries no timeline or sample. `read_thing` never touches the database and never counts against the budget.

### 7.4 `read_fragment` and the budget

`ReadFragment(ctx, id)`: if `reads >= budget` it returns the exhaustion message for `budget` without querying. Otherwise it loads the fragment by id (`sourcedata.FindFragmentsByIDs` → `FindRecordsByIds` on `fragment`, no `deleted_at` filter, so a soft-deleted fragment is readable by id). A query error or no record returns `prompts.DiscoverNoFragment(id)` and does not consume budget. A hit increments `reads` and returns `llmcontext.RenderFragmentRecords`, i.e. one `prompts.FragmentBlock` — a `--- <type> from <source> (ID: <id>) ---` header line, the fragment's `content`, and a trailing blank line (`context.md` § 4 describes the block and its edit-kind variant).

`ReadFragments(ctx, ids)`: an empty `ids` returns `prompts.DiscoverNoFragment("")`. Otherwise ids are trimmed, blank ones skipped, and each is answered by `ReadFragment` in order. After each answer, if `reads >= budget` the loop stops; when fewer parts have been produced than ids were given, the exhaustion message is appended once more as a final part. Parts are joined by single newlines. Consequences: a call whose budget runs out exactly on its last id carries no exhaustion notice; a call made after exhaustion answers every id it reaches with the notice (the first id's answer is the notice, then the loop breaks and, if more ids remain, appends the notice again).

The budget counts successful fragment reads only, across the life of one `Reader`: a run (discover) or a turn (explore). Nothing resets it.

## 8. Consumers

### 8.1 Discover (`internal/discover/loop.go`, `context.go`)

The run context embeds a `*mapreader.Reader` built by `New(app, maxFragmentReads)` with `maxFragmentReads = 12` — the same number as chat's, but with the "per run" exhaustion wording. Discover does not call `Reader.Registry()` or `ChatReadTools()`; it declares its own tools with the discover descriptions: `read_thing` via `IDsTool`, `read_fragment` via `IDTool` with the single parameter `id` (bound to `Reader.ReadFragment(ctx, IDArg(call))`), `list_existing` and `coverage` via `EmptyTool`, `finish` via `IDTool` with parameter `summary`, and `read_colour` via `IDsTool` (handled for every flow but advertised only by flows that name it); one flow also composes a schema with `StringArraySchema`. The `Runner` runs with `MaxRounds = 30`, no `StopBeforeLastDispatch`, `Dispatch = reg.Dispatcher(flow.Dispatch)` so a flow's proposing tools are the fallback, `OnRoundEnd` saving run progress, and no `PromptGuard` or `OnToolDispatched`. `finish` is the one handler returning `done=true`; it stores the run summary from the last reply text, falling back to `StrArg(call, "summary")`. `Run`'s error is returned to the run's caller. What each flow lists, covers, proposes and creates is in `discover.md` § 3 to § 6.

### 8.2 Explore summaries turn (`internal/explore/summaries.go`)

The turn builds `NewChatReader(app)`, takes `reg = reader.Registry()` and advertises `reg.Tools()` — exactly the two tools of § 7.2. The `Runner` runs with `MaxRounds = maxExploreToolRounds` (`4`), `StopBeforeLastDispatch = true`, `Dispatch = reg.Dispatcher(...)` whose fallback answers an unknown tool name with `prompts.DiscoverUnknownTool(name)` (never an error), `OnToolDispatched` streaming each output to the client and collecting it as a persisted tool-result part, `PromptGuard = llm.CheckPromptFits` over the character count of the updated transcript (`context.md` § 6), and `OnRoundEnd` persisting the collected parts. `Generate` streams the model: round 0 reuses a completion started before the runner; later rounds start a new stream, with the tool list withheld (`nil`) on the last round so that round can only produce text. `Run`'s return value is discarded (`_ = runner.Run(...)`); the turn then persists once more and finishes the stream regardless. Seeding, the stream shape and how persisted reads are replayed on later turns are in `explore.md` § 5.

## 9. What the loop does not do

- It does not retry: a `Generate` or `Dispatch` error ends the loop on the spot. Throttle retries around the model call belong to the consumer's `Generate` (discover wraps it in `usage.RetryThrottled`, `llm-queue-quota.md` § 4).
- It does not enforce the budget or any per-tool policy; those live in the handlers (§ 7.4).
- It does not validate tool arguments against the declared schema; the helpers of § 5 answer bad input with zero values and the handlers answer with a text message.
- It does not label results with call ids, and the echo carries names only (§ 3).
- It does not append the final round's results, nor a finishing round's results, to the transcript (§ 2.2 step 7).
- It does not check `ctx` itself (§ 2.3).
- The reader does not filter `Rows` or fragment reads by liveness, does not use `Version`, and never writes.
