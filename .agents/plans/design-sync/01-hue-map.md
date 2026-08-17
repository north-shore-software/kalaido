# 01 — Finalise the section→hue map (doc-only, with Sara)

**Rule being applied:** §3 "Section → hue map" — currently marked **PROPOSED**.
Nothing in code changes in this step; the goal is Sara's sign-off on the hues so
step 02 builds on decided values.

## What to do

1. Show Sara the current proposal (§3 of `app/DESIGN.md`):
   Dashboard cyan `#22d3ee` · Chat yellow `#f5d90a` · Projections violet
   (`--content-7`) · Reflections green (`--content-4`) · Colours blue
   (`--content-1`) · Fragments teal (`--content-8`) · Connections + Settings
   neutral (`fg-2`) · Onboarding/boot brand cyan.
   And the status change: `drifting` moves from yellow to proposed `#ff9f0a`.
2. Build a quick throwaway swatch page (a scratch route or Ladle story is fine —
   delete it afterwards) showing each hue as: a wash-filled pill with ink text, a
   2px active border on `bg-1`, and a solid fill with `#16171a` text — next to a
   magenta pill and a danger pill for comparison.
3. Check the two proximity risks named in the doc, **with Sara looking**:
   - violet (`--content-7`) vs magenta `#f0189c` — must not be mistakable
   - drifting `#ff9f0a` vs danger `#ff5a3c` — must not be mistakable
4. Let her tune any assignment. Constraints that survive tuning (§4 guardrail):
   no section hue near magenta, none near danger, and Chat's hue displaces
   whatever colour drifting uses.
5. Update §3 of `app/DESIGN.md`: final hues, and **remove the PROPOSED marker**.

## Review screen

The swatch page itself. Done when Sara says the set works and the doc holds the
final values.
