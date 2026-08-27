---
title: "Gemini priority tier: traffic_type logs empty even though the tier appears to apply"
status: "open"
author: "agent"
created: "2026-08-27"
---

## Description

The demo hardcode sends `"service_tier": "priority"` on every Gemini request
(`gemini/gemini.go`, `const serviceTier`). The verification log line added alongside it
shows the tier is **not** being applied — or at least not reported:

```
2026/08/26 20:54:28 gemini: traffic_type= model=gemini-3.7-flash
```

Every request in the 2026-08-26 20:54 session logs an empty `traffic_type`. Expected
`ON_DEMAND_PRIORITY` (priority-served) or at minimum `ON_DEMAND` (downgraded); empty means
`usageMetadata.trafficType` was never present in any stream chunk.

Update 2026-08-27: Louis observes requests are visibly faster since the hardcode landed,
so the tier likely IS applying and only the `trafficType` report is missing. Downgraded
from "demo risk" to "verification-signal gap": the log line can't distinguish
priority-served from downgraded requests until we find out why the field is absent.

## Hypotheses (unverified)

- The account/API key doesn't have the priority tier enabled for this model, and the API
  silently ignores the field rather than erroring (requests all succeeded — the field name
  is at least not rejected as unknown).
- `trafficType` is only populated under conditions we're not meeting (e.g. billing tier,
  specific models).
- Field spelling/casing accepted but ignored by the parser rather than mapped
  (`service_tier` vs `serviceTier`) — Google protobuf-JSON normally accepts both for a
  defined field, so this is the least likely.

## Impact

Demo requests may all be riding the standard tier; the hardcode is currently a no-op with
no error signal. The log line is doing its job — this file exists because of it.

## Next step

Check the Gemini API key's project settings / docs for priority-tier availability on
`gemini-3.7-flash`, or test a single non-streaming `generateContent` call with the field
set and inspect the full response.
