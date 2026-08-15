---
title: "Quota banner latches the composer off until the chat panel remounts"
status: "open"
author: "agent"
created: "2026-08-15"
---

## Summary
`quotaHit` is a one-way latch, and it is tripped by any error message containing the substring
"quota" — including provider errors that have nothing to do with the cloud allowance.

## Description
`ChatPanel` holds `const [quotaHit, setQuotaHit] = useState(false)`
(`app/src/components/kalaido/chat-panel.tsx:115`) and sets it from `onError`:

```ts
onError: (err) => {
  if (isQuotaError(err)) { setQuotaHit(true); return; }
  toast.error("Chat failed", { description: err.message });
},
```

Nothing ever calls `setQuotaHit(false)`. Once set, `ChatComposer` disables the send button *and* the
textarea (`chat-composer.tsx:30,45`), so the conversation is unusable until the panel remounts —
which for refine surfaces only happens when `session.clientId` changes
(`refine-chat-panel.tsx:38`).

The match is also broader than intended. `isQuotaError`
(`app/src/api/kalaidoscope/cloud/quota.ts`) is:

```ts
return msg === "quota_exhausted" || msg.toLowerCase().includes("quota");
```

Only the first arm is the deliberate 402 tag (`api/kalaidoscope/chat.ts:243`). The substring arm
matches any provider error text mentioning quota — e.g. Gemini's `Quota exceeded for quota
metric …`, which is a rate limit on the upstream key, not the user's allowance. That surfaces the
wrong message ("Upgrade your plan") and permanently disables the composer for a transient error.

## Steps to Reproduce
1. Cause a provider error whose message contains "quota" (e.g. hit an upstream rate limit on a BYOK
   Gemini key).
2. Observe the banner and the disabled composer.
3. Wait — the error is transient, but nothing re-enables the composer.

## Expected Behavior
Only a genuine 402 raises the allowance banner, and a transient error clears once a later turn
succeeds.

## Observed Behavior
Any "quota"-containing error shows the upgrade banner and disables the composer for the life of the
mounted panel.

## Context / Relevant Code
- `app/src/components/kalaido/chat-panel.tsx:115,176-185,242-249`
- `app/src/components/kalaido/chat-composer.tsx:30,45`
- `app/src/api/kalaidoscope/cloud/quota.ts`
- `app/src/api/kalaidoscope/chat.ts:242-243`
- Found while investigating the "creating a projection got stuck" report on 2026-08-15. It was not
  the cause there (no 402 in the logs), but it is a second way for send to stick.
