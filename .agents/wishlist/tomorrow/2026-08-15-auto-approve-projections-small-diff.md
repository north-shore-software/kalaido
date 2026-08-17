---
title: "Auto-approve projections when diff is below a certain percentage threshold"
status: "open"
author: "human"
created: "2026-08-15"
---

## Summary
Projections require manual approval regardless of how minor the diff is; user suggested an "auto-approve" feature when the diff percentage is below a threshold.

## Description
There is currently no auto-approval mechanism for projections when generated changes are minimal. User suggested adding an auto-approve capability for projections when the diff is less than a specified percentage.

## Steps to Reproduce
1. Regenerate a projection resulting in a very small percentage diff.
2. Observe that manual review/approval is still required.

## Expected Behavior
Ability to auto-approve projections when the diff percentage is below a set threshold.

## Observed Behavior
All projection diffs require manual approval regardless of percentage change.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User reported: "maybe we need an "auto-approve" for projetions when the diff is less than a certain percentage"

---
title: "Auto-approve snapshots that barely changed"
status: "draft"
author: "claude"
created: "2026-08-15"
related: "2026-08-15-chained-snapshot-generation.md"
---

**Scope**: design agreed in conversation, not yet broken into implementation steps. Projections only. Backend decision path (Go/PocketBase), one workspace setting, and the audit surface.

## Context

Most candidates get approved exactly as generated. Reviewing them is a formality — you read a document that is materially the same as the one it replaces, and click Approve. This feature skips that formality when the candidate barely moved: if a background-generated snapshot differs from the live one by no more than a configured percentage, approve it without asking.

Paired with chained generation (see `related`), this is what turns "a fragment landed" into "the graph is up to date" with no interaction at all in the common case — the chain generates, small diffs approve themselves, each approval unblocks the next layer, and only the candidates that genuinely changed are left waiting for you.

The threshold is a **convenience, not a safety property** — see §7. The audit trail in §5 is what makes it recoverable.

## 1. What gets compared

The candidate's content against the **live approved snapshot's** content: `parseProjectionOutput(output).content` on both sides, i.e. the markdown a reader would see, not the raw stored JSON. Changes to surrounding metadata never count as content change.

**Metric: line-based.** Compute a line diff, then

```
ratio = (added lines + removed lines) / max(lines in live, lines in candidate)
```

Auto-approve when `ratio <= threshold`. Line granularity matches how a reader eyeballs the change and is cheap to compute; character-level would report reflowing as change, and the number a user types needs to be predictable.

A projection with **no live snapshot yet** has nothing to compare against and is never auto-approved.

### This introduces the first diff in the codebase

There is no diff implementation on either side today: `components/kalaido/diff.tsx` is decorative (coloured skeleton bars, no algorithm) and `snapshot-compare-pane.tsx` renders the two versions side by side without comparing them. The decision here happens server-side with no client attached, so the diff must be in Go, and nothing in `go.mod` provides one — either a small LCS line-diff implementation or a new dependency.

Since the ratio has to exist anyway, **surface it in the review UI** ("differs by 3%") even when it lands above the threshold. It is how a user calibrates what number to set, and it costs one field on the response. There is an open bug on the compare view (`.agents/bugs/2026-08-15-diff-viewer-scrolling-markdown-and-color-coding-issues.md`) — a real line diff is the thing that would let that view actually highlight changes, but that is not in this scope.

## 2. Which candidates are eligible

**Background-generated candidates only.** A candidate produced by the chain, or by any future scheduled refresh, is eligible. A candidate you asked for by hand — detail-page Refresh, dashboard row Refresh — is never auto-approved: you clicked a button because you wanted to see the result.

The eligibility test should be written as *"this generation was not user-requested"* rather than *"this generation came from the chain"*, so a later scheduler qualifies without revisiting it. Today the chain is the only background producer.

## 3. Where the decision happens

Immediately after the candidate is written, server-side, before any client sees it. The sequence is: generate → write pending snapshot → compute ratio against live → under threshold? approve it now, marked as auto-approved.

**This composes with the chain for free, and that composition is the point.** Approving mutates the candidate row, and that row carries the chain mark, so an auto-approval is a write of a chain-marked record — the chain hook fires, re-evaluates, and generates whatever the auto-approval just unblocked. A whole graph can advance from stale to approved without a human, which is the intended behaviour and precisely why §5 is not optional.

An auto-approval is an ordinary approval in every other respect: same `engine.ApproveSnapshot`, same sequence numbering, same staleness clearing. Nothing about the resulting snapshot is second-class.

## 4. Settings

Workspace-level, on the existing `kalaidoscope_config` row:

| Field | Meaning |
|---|---|
| `auto_approve_enabled` | Off by default. Opt-in — approving on someone's behalf is a trust decision. |
| `auto_approve_threshold` | Percent. Kept separate from the enable flag so `0` remains meaningful: auto-approve only byte-identical output. |

Per-projection overrides are deferred (§8) — tolerance genuinely differs between a volatile digest and a stable reference doc, but a single number is the way to find out what the right numbers are before committing to per-item UI.

## 5. Audit

Non-negotiable given §3: things get approved while you are not looking, so you must be able to see what happened.

- **A mark on the snapshot** recording that it was approved automatically, and the ratio that justified it. Visible in the projection's timeline alongside the ordinary approvals.
- **A dashboard summary** — recent auto-approvals listed with the projection name and the diff percentage, each linking to that snapshot so the change can be read in one click.

**No undo in v1.** Snapshots are immutable and history is preserved, so nothing is lost: the previous version is still there, and "reverting" would mean publishing it again as a new live snapshot. Worth adding if auto-approval turns out to fire on changes you would have rejected — which the dashboard summary is what tells you.

## 6. Bounds

- Auto-approval only ever fires on a candidate that was generated legitimately, i.e. for an entity with nothing pending upstream — it cannot resurrect the stale-on-arrival problem, and never bypasses the blocked-upstream guard.
- The chain's hop cap still bounds the cascade, and it is the backstop that matters more once approvals stop being human-gated.
- Quota exhaustion ends the chain; auto-approval changes nothing about that path.
- Reflections are out of scope: they have no review gate, so there is no approval to automate.

## 7. Risk, stated plainly

Percentage of text changed is a proxy for "nothing important happened", and it is lossy in two specific ways:

1. **A small diff can be the most important one.** `Revenue up 5%` → `Revenue down 5%` is a two-character change that sails under any threshold.
2. **The metric drifts with document length.** A projection that appends an item per day crosses a given threshold constantly while it is short and almost never once it is long — the same setting means different things at different times for the same projection.

This does not make the feature wrong: the premise is that these snapshots are usually approved unread anyway, so the realistic comparison is against *rubber-stamping*, not against careful review. But it means the threshold buys convenience, not correctness, and the recoverability in §5 is what the design leans on.

## 8. Deferred

- **Per-projection thresholds**, once there is evidence about what numbers work.
- **Undo**, as re-publishing a previous snapshot.
- **Using the new line diff in the review UI** to actually highlight changes, which is the open compare-view bug rather than this feature.
