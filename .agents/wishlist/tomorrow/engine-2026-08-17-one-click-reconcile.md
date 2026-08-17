---
title: "Asynchronous / Background Lens Generation and Non-Blocking Candidate Approval Flow"
status: "specified"
author: "human"
created: "2026-08-13"
updated: "2026-08-17"
---

## Summary
Decouple candidate approval from synchronous LLM operations so that approving a snapshot returns instantly. Lens distillation runs in the background, and the "Approve & next" review flow immediately advances to the next available candidate or transitions to a holding queue view rather than blocking the UI with a spinner.

## Motivation & Context
1. **Lens Distillation Latency**:
   - Currently, committing a refinement / approving a candidate synchronously triggers `DistillAndUpdateLens` on the backend.
   - On local models (e.g. Ollama) or slow providers, this holds the HTTP connection open for seconds or minutes, freezing the UI.
2. **Review Flow Stalls ("Approve & next")**:
   - When advancing through candidate approvals, if the next candidate is not yet generated, the review UI hangs on a loading spinner on the current projection review page until model generation completes.

## Desired Working End State

### 1. Instant Snapshot Approval with Background Lens Distillation
- **Immediate Approval**:
  - The snapshot record is committed immediately with `status = "approved"`.
  - The approved text becomes the live plan of record immediately, as this is the exact content approved by the user.
  - The HTTP request returns success immediately without waiting for LLM distillation.
- **Asynchronous Distillation**:
  - Lens distillation (`DistillAndUpdateLens`) is enqueued and executed in a background worker / goroutine.
  - The lens prompt is only needed for *future* snapshot regenerations, so the active snapshot is fully valid while distillation is in flight.
  - Upon background completion, the new lens record is saved, and `current_lens_id` on the parent entity and `lens_id` on the snapshot are updated.

### 2. Non-Blocking "Approve & Next" Review Workflow
- **Immediate Advance to Ready Candidates**:
  - When the user clicks "Approve & next", the current candidate is committed immediately.
  - If another entity in the graph already has a generated pending candidate ready for review, the UI navigates straight to that review page without delay.
- **Holding / Queue View when Frontier is Generating**:
  - If no other candidate is currently ready for review (e.g. downstream or frontier nodes are still being generated in the background):
    - The UI does not remain stuck on the approved projection's review page with a blocking spinner.
    - Instead, the UI navigates to a holding / queue view that surfaces the graph drainage progress and indicates which items are currently being generated.

## Undecided / Open Design Decisions
- **Distillation Failure Handling**: Specific UX when background distillation fails (e.g. subtle toast notification, inline warning banner on projection details, or automatic background retry).
- **Distillation In-Progress Indicator**: Whether a subtle badge (e.g. "Distilling lens in background…") should appear on the projection detail page while distillation is running.
- **Holding View Surface**: Exact surface for the drainage holding view (reimagining the currently unused `/rotation` route vs. a dedicated review-queue holding screen).

## Acceptance Criteria
- [x] Approving a projection refinement or new projection returns HTTP success immediately without waiting for LLM lens distillation.
- [x] Approved snapshot text is immediately visible and marked as the live snapshot (plan of record).
- [x] Lens distillation runs asynchronously in the background and attaches the resulting `lens_id` once finished.
- [ ] In "Approve & next", if another pending candidate exists, the user is navigated directly to it with zero intermediate wait.
- [ ] In "Approve & next", if no candidates are ready yet, the user is transitioned to a holding/queue view showing in-flight generation status rather than hanging on the review page.

---
title: "Chained snapshot generation and small-diff auto-approval cascade"
status: "specified"
author: "human"
created: "2026-08-15"
updated: "2026-08-17"
supersedes:
- ".agents/wishlist/tomorrow/2026-08-15-chained-snapshot-generation.md"
- ".agents/wishlist/tomorrow/2026-08-15-auto-approve-projections-small-diff.md"
---

## Summary
Provide users with a 1-to-2 button automated workflow to regenerate and bring all out-of-date items (projections and reflections) up to date across their entire workspace. By combining background chained generation with automated small-diff approvals, users can update their entire scope without manually generating and reviewing every intermediate change.

## User Experience & Purpose
- **Goal**: Bring the entire workspace up to date in one or two actions instead of manually stepping through each entity.
- **Problem Today**: Updating a graph of dependent reflections and projections requires clicking into each item, waiting 10-30 seconds for LLM generation, clicking approve, and repeating down the entire chain. Most candidates barely changed, turning the process into tedious rubber-stamping.
- **Target Flow**:
    1. The user clicks **"Generate all"** (or "Update workspace") from the dashboard.
    2. The system automatically processes the graph in topological order:
        - Reflections automatically generate and publish live updates (no review gate needed).
        - Projections generate candidate snapshots.
        - Projections with diffs below the auto-approve threshold are approved automatically in the background, immediately unblocking downstream items.
    3. The user only ever has to manually review the few projections where material changes occurred, or simply watch the entire workspace settle to "Up to date".

## Desired Working End State

### 1. The Chain Propagation Mechanism
- **Chain Mark on Records**:
    - The snapshot record carries a chain mark with a remaining-hops count.
    - "Generate all" generates the first candidate marked with the initial hop count.
    - A server-side hook on snapshot write (create/update) inspects the mark:
        - **Marked** → Re-evaluates topological status (`internal/status`), finds the next unblocked actionable entity, and triggers generation carrying the decremented mark.
        - **Unmarked** → Normal standalone generation; does not propagate.
- **Approval Cascades**:
    - Approving a projection mutates the candidate snapshot (`status = "approved"`). Because the record retains the chain mark, the update hook fires, detects unblocked downstream nodes, and generates them.
    - **Reflections in Chain**: Reflections have no review gate; when generated during a chain, they publish live snapshots directly, immediately unblocking downstream projections.
    - **Refinements**: When a user refines a chain-marked candidate and commits, the chain mark propagates to the new snapshot so the downstream cascade continues.
- **Single-Item Manual Triggers**:
    - Single-item actions (detail page "Refresh", dashboard row refresh) write unmarked records and never propagate cascades.

### 2. Auto-Approval of Small Diffs
- **Diff Metric (Line-based)**:
    - Compares candidate output content against the live approved snapshot's content (`parseProjectionOutput(output).content`).
    - Metric:
      ```
      ratio = (added lines + removed lines) / max(lines in live, lines in candidate)
      ```
    - If `ratio <= threshold` (and `auto_approve_enabled` is true), the server auto-approves the snapshot immediately upon generation before any client sees it.
    - A projection with no prior live snapshot is never auto-approved.
- **Composition with Chain**:
    - Auto-approving mutates the snapshot record carrying the chain mark, immediately triggering the chain hook to advance the next layer of the graph without human interaction.
- **Diff Surface in UI**:
    - Review UI surfaces the calculated diff percentage (e.g. "differs by 4%") so users can calibrate their threshold settings.

### 3. Workspace Settings
Stored on `kalaidoscope_config`:
- `auto_approve_enabled` (boolean, default: `false` — opt-in).
- `auto_approve_threshold` (percentage integer 0–100; `0` allows auto-approving byte-identical outputs).

### 4. Audit Trail & Visibility
- **Snapshot Audit**: Snapshots approved automatically record an `auto_approved: true` flag and the recorded diff ratio, displayed in the projection's timeline.
- **Dashboard Summary**: Dashboard displays recent auto-approvals with entity names and diff percentages, with direct links to each snapshot.

### 5. Guards, Concurrency & Cancellation
- **Hop Cap**: Decrementing hop count ceilinged at total workspace entity count prevents infinite loops.
- **In-flight Deduplication & Serial Execution**: Generations are strictly serialized (concurrency of 1) and deduplicated per entity.
- **Quota Exhaustion**: Model quota exhaustion ends the chain gracefully without error loops.
- **Cancellation (v1)**: No central cancellation handle required for v1; runs sequentially across the unblocked frontier until complete or capped.

## Acceptance Criteria
- [ ] Clicking "Generate all" on the dashboard initiates a background generation run across unblocked entities in topological order.
- [ ] In-chain reflections generate and publish live snapshots automatically, unblocking dependent projections.
- [ ] When `auto_approve_enabled` is true, generated candidate diffs under the threshold are automatically approved on the backend without requiring manual clicks.
- [ ] Auto-approvals immediately trigger the next unblocked downstream generation in the chain.
- [ ] Candidates exceeding the diff threshold remain in the pending state for manual review.
- [ ] Single-entity manual refreshes do not trigger automatic cascades.
- [ ] Auto-approved snapshots are identifiable in the audit timeline and dashboard summary.

# Engine Update

## Product Spec

### Approval & review flow (async lens generation, 08-13)
- Approving a snapshot or refinement completes instantly — no more waiting on a spinner while the lens distills.
- The approved text becomes the live plan of record immediately.
- "Approve & next" jumps straight to the next ready candidate with zero wait.
- When nothing is ready yet, you land on a holding/queue view showing generation progress across the graph, instead of hanging on the current page.
- DECIDED: the holding view is a dedicated review-queue screen — an ordered list of pending/generating/ready items that auto-advances you into the next candidate when it's ready.
- DECIDED: "Approve & next" follows topological order by default (upstream approvals unblock downstream work), but the queue list lets you click into any ready candidate out of order.
- DECIDED: the queue screen is reached from the dashboard (e.g. a "3 awaiting review" link) — not a persistent nav item. The dashboard stays the single entry point.
- DECIDED: distillation failures are silent — the previous lens keeps working, and the failure is only visible in the projection's detail/timeline. No toast, no badge elsewhere.

### Provider selection (explicit provider config, 08-14)
- Choosing "Local Ollama" actually saves your choice (today it's a label that writes nothing).
- You can change your workspace's LLM provider later instead of being locked in at creation.
- DECIDED: provider choice is per-workspace — each workspace carries its own provider config (e.g. a personal workspace on Ollama, a work one on a cloud provider).
- DECIDED: switching provider shows a short note that future generations use the new model and existing content stays as-is, plus a one-click offer to run "Generate all" to rebase the workspace onto the new provider.

### Generation reliability & visibility (LLM gateway, 08-15)
- Local Ollama no longer thrashes or crashes when multiple generations overlap — requests queue one at a time.
- Regenerating the same snapshot from the same inputs gives the same output (deterministic temp-0 generation).
- Live streaming stats during generation: token count, tokens/second, activity indicators in chat panels and draft previews.
- DECIDED: telemetry is a subtle live token counter with an activity pulse in streaming surfaces (chat panel, draft preview, queue rows) — enough to answer "is it making progress or hung?" without dashboard clutter. No tokens/sec or elapsed-time readouts.
- DECIDED: interactive work preempts background work. User-initiated generations (chat, refinement, on-demand review candidates) jump to the front of the queue; the in-flight background task finishes, then the rest of the chain waits until interactive work drains.

### One-click workspace update (chained generation + auto-approval, 08-15)
- A "Generate all" / "Update workspace" button that brings every out-of-date item current in topological order — no more clicking through each item, waiting 10–30s, approving, repeating.
- Reflections update live automatically with no review gate.
- DECIDED: reflections keep a snapshot history like projections; the detail page shows when each update happened and a diff against the previous version — no gate, but full auditability if a bad reflection update poisons downstream projections.
- Projections whose changes fall below a diff threshold are auto-approved silently; you only review the ones with material changes.
- Opt-in settings: an auto-approve toggle (off by default) and a threshold percentage.
- DECIDED: auto-approval applies only during "Generate all" chain runs. A single-item manual refresh always presents the candidate for review, regardless of diff size.
- DECIDED: default threshold is 5% when first enabled — catches formatting jitter and tiny wording shifts while sending anything substantive to review.
- DECIDED: v1 gets a soft "Stop" button on the queue screen — the in-flight generation finishes, but the chain doesn't start the next one. (Supersedes the 08-15 spec's "no cancellation in v1".)
- DECIDED: when a run ends early (quota exhausted, provider error, hop cap), the queue screen and dashboard show a persistent "stopped early — quota exhausted (7 of 12 updated)" state with a resume button that picks up where it left off. No toast.
- DECIDED: a pending candidate whose upstream dependency is re-approved with new content is discarded and auto-regenerated from the fresh inputs before being offered for review — you never review against stale inputs, at the cost of an extra generation.
- The review UI shows the diff percentage ("differs by 4%") so you can calibrate your threshold.
- Auto-approved items are flagged in the projection timeline, and the dashboard summarizes recent auto-approvals with links.
- DECIDED: any snapshot in the timeline (auto- or manually approved) has a "revert to this version" action that makes it the live snapshot again; downstream items simply show out-of-date. Auto-approve mistakes are one click to fix.
- Single-item refreshes stay single-item — no accidental cascades.

### Output quality (prompt audit, 08-17)
- Generated documents are clean markdown with no "Here is the summary:" preambles or closing remarks — directly usable without cleanup.
- Refining a projection evolves the existing lens instead of re-distilling from scratch, so accumulated style/structure nuances survive across refinement cycles.
- Chat refinement updates drafts via structured tool calls rather than dumping document text into the conversation.

The through-line: today updating a workspace is serial, blocking, and manual; the target experience is press one button, watch the workspace settle to "Up to date", and only review the few changes that actually matter.

### Corrections from the domain model (.agents/spec/model.md)

The domain model overrides or reframes four of the decisions above:

- **Revert is a re-publish, not a flag flip.** Snapshot history is append-only and "active" is derived at query time from approval sequence numbers — there is no mutable active flag to point backwards. "Revert to this version" therefore publishes a *new* Approved Snapshot carrying the old artifact (next sequence number), which supersedes the current one. Same UX, different mechanism, and the timeline honestly shows the revert as an event.
- **Auto-approval is an Approval Policy, not a new subsystem.** model.md already defines per-entity Approval Policies: Manual (projection default) and Automatic (reflection default). Small-diff auto-approval is a third, conditional policy layered on Manual — and "reflections have no review gate" should read "reflections default to the Automatic policy" (a Manual reflection is a legal configuration the queue must handle).
- **Stale pending candidates: the mechanism already exists.** Our "auto-regenerate on upstream change" decision is model.md's **Candidate Queue Replacement** + staleness triggers: the fresh candidate *replaces* the pending one, which is retired to the Candidate Execution Log (not discarded) — auditable, and only the latest candidate is ever approvable.
- **"Chain marks" conflict with the engine model.** model.md's **Engine Execution & Liveness** says nothing self-starts: an external driver reads the stale set and triggers generation (never approval). "Generate all" should be that driver — drain the stale/actionable set in topological order until it's empty — rather than the wishlist's chain-mark-with-hop-count mechanism. Termination comes free from DAG acyclicity plus staleness clearing; no hop cap needed. Approval (auto or manual) stays with the policy layer, keeping the driver/approval separation intact.

# UX — background updates / "reconcile" flow

Part of the engine update ([product spec](../engine-update.md)). The reconcile loop as the user sees it: "Generate all", stale-set drainage, small-diff auto-approval, the review-queue screen (topological auto-advance, free pick, soft stop, resume, stale-candidate regeneration), reflection timelines, dashboard drainage/auto-approval summaries, revert. Sources: chained generation wish (08-15), async approval flow (08-13).

## Current state

More exists than the wishes assume:

- **The staleness evaluator is built.** `GET /api/rotation` (`internal/status/status.go`) computes the full DAG: topological sort, new-fragment diffs against each live snapshot's resolved context, stale vs. blocked dependencies, and pending reflection windows. This is the "stale set in topological order" the reconcile driver needs — it just has no driver consuming it server-side; only the UI polls it.
- **A queue screen already exists.** The 08-13 wish calls `/rotation` "currently unused", but `app/src/features/rotation/pages/Rotation.tsx` is a working early reconcile screen: topo-ordered list, top card actionable, candidate auto-generated for the current projection, approve-to-advance, skip, blocked rows labeled "waiting on X", reflections regenerate-and-publish all pending windows. It is not linked from the nav — reachable only by URL. This is the seed of the decided review-queue screen, not a greenfield build.
- **Approve & next exists but blocks.** `ProjectionReview.tsx` + `findNextTarget` (`app/src/features/rotation/next-target.ts`): after approval it re-fetches the rotation plan, finds the first actionable entity, and — if it has no candidate — generates one *synchronously in the request*, holding the user on a "Working out what's next…" spinner. Even includes the "approved but needs another pass" self-targeting case. The flow logic matches the spec; only the blocking generation and the missing holding view differ.
- **The dashboard is already the entry point.** Needs-action section driven by the rotation status, caught-up banner, per-row refresh that generates a candidate and jumps into review — matching the decided "dashboard is the single entry point" shape.
- **Timelines:** projection detail has a version timeline over the append-only snapshot history. Reflection detail regenerates and shows the live snapshot but has no per-window supersession history view, and neither surface shows diffs or has a revert action.

## Missing

- Any server-side background work (the colour worker aside): all snapshot generation and distillation runs inside HTTP handlers. The reconcile driver — "Generate all" draining the stale set in topo order as a background run — doesn't exist, nor do run status, soft stop, resume, or stopped-early state.
- Auto-approval policy: no `auto_approve_enabled`/threshold settings, no diff-ratio computation, no `auto_approved` audit flag, no dashboard auto-approval summary.
- Candidate retirement per model.md: `AppendSnapshot` just appends — a newer candidate doesn't replace/retire the older pending one server-side (the review UI compensates by always tracking the newest pending). No Candidate Execution Log.
- The decided queue-screen behaviors: free pick into any ready candidate, auto-advance on readiness, dashboard link into it, generation-in-progress rows with live token pulse.
- Revert-as-republish, reflection per-window history with diffs, and the diff-percentage display in review.
