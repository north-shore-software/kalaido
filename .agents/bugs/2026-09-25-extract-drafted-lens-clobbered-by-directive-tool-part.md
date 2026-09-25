---
title: "ExtractDraftedLensAndSpec blanks the lens if a directive-form update_lens part follows the data-lens part"
status: "open"
author: "agent"
created: "2026-09-25"
---

## Description
`refinement.ExtractDraftedLensAndSpec` (and `chat.Flatten`) still unmarshal `tool-update_lens` parts as `{lens}`; the live tool now sends `{directive}`, so the read yields `lens = ""`. The assignment in `ExtractDraftedLensAndSpec` is unconditional, so a directive-form tool part ordered after the `data-lens` part in the same message would overwrite the compiled lens with an empty string. It is safe today only because `StreamTurn` appends tool parts before the `data-lens` part; nothing enforces that order for hydrated or client-supplied messages.

## Steps to Reproduce
1. Construct an assistant message with parts `[data-lens{lens:"X"}, tool-update_lens{input:{directive:"…"}}]` and pass it through `ExtractDraftedLensAndSpec`.

## Expected Behavior
The compiled lens `X` is returned.

## Observed Behavior
An empty lens; commit then falls back to the snapshot output.
