---
title: "Draft/review panel renders a different name than the stored draft (Robin shown where backend says Sarah)"
status: "open"
author: "agent"
created: "2026-08-26"
---

## Description

Frontend-only rendering/state defect. During a refinement conversation on 2026-08-26 (~23:38,
projection `y9cjy1a540g802d` "Persona Names List"), the stored `update_draft` payload — and the
snapshot later committed from it — reads:

```
### Case Study User
- **Sarah** — Solo Founder & Lead Engineer (Nexus Launch)
```

but the UI panel displayed:

```
Case Study User
Robin — Solo Founder & Lead Engineer (Nexus Launch)
```

i.e. the name from the *first* bullet of the preceding "Personas" list was substituted for Sarah
while the role text stayed correct. Both `chat_message` rows (drafts `661d104475228g4`,
`dw7voxh2v0gcrkf`) and the committed snapshot `0omjc3va1743kwm` contain Sarah, so the corruption
happens between the stored content and the rendered markdown (draft-state merge or markdown
renderer associating list items with the wrong section).

## Steps to Reproduce

1. In a refinement chat, produce a draft with two `###` sections each containing bold-name
   bullets (`- **Name** — role (label)`), where the model streams an updated draft over a
   previous one.
2. Compare the rendered panel against the `update_draft` input stored in `chat_message`.

(Exact trigger not yet isolated — may require the second `update_draft` revision of the same
draft, as in this session.)

## Expected Behavior

The panel renders exactly the stored draft: Sarah under "Case Study User".

## Observed Behavior

Panel showed Robin under "Case Study User" while backend records all contain Sarah. Backend data
verified correct end-to-end (chat messages, committed snapshot, later regenerations).
