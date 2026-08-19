# Design-sync steps — do in order

Read `README.md` (the protocol) before every session. One box per step; check it
off only after Sara has reviewed and the app + DESIGN.md are consistent.

## Foundations (shared code; each names a review screen)

- [x] `01-hue-map.md` — finalise the section→hue map with Sara (Projections #4ade80, Reflections #c084fc, Colours #fda4af, Fragments #a3e635)
- [x] `02-section-tokens.md` — introduce `--section-*` tokens, re-point the primitives (Capture and rail nav hover exceptions logged)
- [x] `03-buttons-pills.md` — button dedupe, pill fixes (default 40px button size rule change logged)
- [x] `04-overlays.md` — reskin dialogs/popovers to §5 (dialog, alert-dialog, dropdown-menu, popover, select, sheet, hover-card, context-menu, combobox, chart tooltip ✓; menubar + navigation-menu skipped — unimported, deleted in step 18 instead)
- [x] `05-composer.md` — chat composer now wears the §7 send recipe; shared send-button classes extracted (quota-notice tone moved to step 17)
- [x] `06-icons.md` — stroke widths per §6

## Screens (one per step)

- [x] `07-dashboard.md`
- [x] `08-chat.md`
- [x] `09-projections.md` (list · detail · draft · review)
- [x] `10-reflections.md`
- [x] `11-colours.md`
- [x] `12-fragments.md` (stream)
- [x] `13-rotation.md`
- [x] `14-connections-import.md`
- [x] `15-settings.md`
- [x] `16-onboarding-boot.md`
- [ ] `17-context-ui.md` — review of the post-sweep feature surface: context-bar tints, markdown rendering (#59), inline naming (#62); includes re-review of the 09/10 headers #62 changed

## Finish

- [ ] `18-cleanup.md` — dead code and dead tokens (only after all screens pass)

---

## Rule changes (log)

<!-- agent: append one line per DESIGN.md rule change:
     date · rule (§) · what changed · screens needing re-review -->
2026-08-17 · §3, §7 · Solid Magenta and solid Danger use white text (#ffffff) instead of dark #16171a · Projections (Review/Draft), Onboarding, Modals
2026-08-17 · §7 · Added 'section' button variant (solid section accent fill with #16171a text) for section creation actions · Projections, Reflections, Colours
2026-08-17 · §7 · Changed default button size from 32px (14px padding) to 40px (20px padding) · All screens using default buttons
2026-08-17 · §2 · Scaled type roles proportionally based on 16px body (display: 40px, card-title: 18px / 0 tracking, body: 16px / 0.02em tracking, body-sm: 14px / 0.015em, row: 15px, item: 14.5px, btn: 13px, meta: 12.5px, mono-sm: 12px, label/crumb: 11px, pill: 10.5px, overlay-title: 22px) · All screens
2026-08-17 · §2 · Display leading 1.05 → 1.15 · All screens with a page title
2026-08-17 · §3 · Grey ramp re-tuned (gray-0 #16171a → #121315 through gray-10 #f5f6f6 → #f5f6f8; cooler, slightly darker ground) · All screens
2026-08-17 · §3 · Magenta re-based #f0189c → #ff2e93; critical/danger #ff5a3c → #ff3333 · Everywhere magenta/danger appears
2026-08-17 · §3 · Wash alpha 0.12–0.14 → 0.08 (0.04 for magenta and critical) · All washes
2026-08-17 · §4 · Entity kinds wear their home section's hue everywhere (projection green, reflection violet, fragment lime); replaces per-entity ColourSwatch identity outside Colours · Dashboard, Projections, Reflections, Fragments
2026-08-17 · §4 · Reassurance states ("up to date", "latest", draft/pending previews) wear the section accent; drifting/critical stay constant · Projections, Reflections, Rotation
2026-08-18 · §3 · Yellow-as-source-tint abolished: pickers, source/pin chips and LastN controls borrow the route's section accent (magenta stays reserved for focus) · Chat, Projections, Reflections
2026-08-18 · §3 · Fragments do not wear their Colour in the Stream: cards and timeline dots take the section accent; the Colour shows only in the fragment drawer · Fragments
2026-08-18 · §7 · 'section' button variant chamfers on hover (rest state square, borderless) · Projections, Reflections, Colours, Fragments
2026-08-18 · §6 · Icon stroke rule enforced globally via CSS (svg.lucide 1.5; checks/chevrons re-asserted at 2) rather than per-callsite props · All screens
2026-08-18 · §7 · Inline-rename recipe added (EditableText: inherits surrounding type, hover pencil, section-accent editing underline); page titles renameable via PageHeader onTitleCommit · Projections, Reflections

## Exceptions (log)

<!-- agent: append one line per recorded special case:
     date · screen · what · DESIGN.md section where the exception is noted -->
2026-08-17 · workspace shell (icon rail + capture modal) · Capture always stays brand cyan (#22d3ee) instead of tinting with the active section — rail icon, modal save button, modal field focus · §4
2026-08-17 · workspace shell (icon rail) · Nav items show 2px left border on hover & active in destination hue, hover with destination wash fill, and maintain fg-2 text/icon colour · §5
