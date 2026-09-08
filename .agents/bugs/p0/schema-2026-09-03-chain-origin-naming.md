---
title: "`chain_origin` — chain or wave? and is the field the right concept?"
status: "open"
author: "human"
created: "2026-09-03"
---

## Description

`projection_snapshot` / `reflection_snapshot` (§ 2.8 / 2.9) carry `chain_origin`, a `text` field documented as holding `generate_all` or empty.

Note left on `kalaidoscope/docs/schema.md`:

> is it chain or wave? let's be consistent. is it even relevant though? is it generate_origin? or "action_after_generate" ?

## Context / Relevant Code

- Schema definition: `kalaidoscope/migrations/1748000000_init_schema.go`.
- Doc: `kalaidoscope/docs/schema.md` § 2.8 / 2.9.
- The same concept appears in `kalaidoscope/docs/context.md` § 3 as the "chain origin" on the context (`llmcontext.WithChainOrigin`), where a chain-wave (`generate_all`) origin widens snapshot resolution from `status = 'approved'` ordered by `-approval_sequence_number` to `status != 'generating' && status != 'discarded'` ordered by `-created`. `kalaidoscope/docs/context.md` also states that only the reconcile wave sets a chain origin (`kalaidoscope/docs/rotation.md` § 3) — i.e. the docs use both "chain" and "wave" for the same machinery.
