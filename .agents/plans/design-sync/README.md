# Design-sync execution plan — READ THIS FIRST

You are an agent helping **Sara** (the designer) bring the app in line with
`app/DESIGN.md`. The doc has already been adjudicated and updated — it is now the
rulebook. Your job is to change the **app** to match it, one reviewable step at a
time, with Sara visually approving every step.

`00-INDEX.md` lists the steps in order. Do them in order. One step per session is
fine; never start a step before the previous one is checked off.

## The loop — follow this on EVERY step, no exceptions

1. **Announce.** Before touching any file, tell Sara in plain language:
   - what you are about to change (screen + components),
   - **which DESIGN.md rule** you are applying — quote the rule and its section
     number (e.g. "§5 Hover: *bordered buttons promote their border colour, they
     never change fill*").
2. **Change.** Make the edits listed in the step file. Stay inside the step's
   scope — if you notice an unrelated problem, write it down in
   `.agents/bugs/` (one file per finding, see the template in
   `.agents/bugs/README.md`) and move on. Do not fix it.
3. **Stop and show.** Tell Sara the change is ready in the running app (HMR) and
   list exactly what to look at. Then **stop and wait**. Do not continue to the
   next item or step until she has looked.
4. **If Sara wants an adjustment**, make it, then check it against DESIGN.md:
   - **If it complies** — done, continue.
   - **If it violates a rule** — tell her, in this exact shape:
     1. Name the rule being violated (section + quote).
     2. Offer her two options, and spell out what each means:
        - **Option A — change the rule.** Before doing it, list every other
          place in the app that rule currently governs (search the codebase;
          be concrete: file + screen names), so she can see what else would
          change or need re-review. If she confirms, edit `app/DESIGN.md`,
          then add a line to the "Rule changes" log at the bottom of
          `00-INDEX.md` naming the rule, the change, and the screens that now
          need re-review.
        - **Option B — keep her change as a special case.** Do NOT change the
          rule. Instead add a clearly-marked exception to the relevant section
          of `app/DESIGN.md` (pattern: "**Exception:** on <screen>, <thing>
          does <X> — a deliberate one-off, do not extend."). Log it in
          `00-INDEX.md` under "Exceptions".
   - Never silently leave the app and the doc disagreeing. Every step must end
     with the two consistent — via compliance, a rule change, or a recorded
     exception.
5. **Check off.** Mark the step done in `00-INDEX.md` (change `[ ]` to `[x]`),
   with a one-line note if anything notable happened.

## Ground rules

- **One screen at a time.** Steps 01–06 are foundations that touch shared code;
  each names a "review screen" — verify there, and list the other screens the
  change touches so Sara can spot-check.
- **The doc wins by default.** If code and doc disagree and the step doesn't say
  otherwise, change the code. If you think the doc is wrong, that is a rule-change
  conversation (loop step 4), not a silent code decision.
- **Cite rules by section**: §2 type, §3 colour, §4 accent meaning, §5 form
  (radius/borders/chamfer/shadows/glow/hover/motion), §6 layout, §7 recipes,
  §8 token names, §9 light mode.
- **Verify every step**: the app compiles (`npx tsc --noEmit` in `app/`) and the
  screen looks right in the running app. Don't claim done without both.
- **Type migration note (steps 07–16):** the legacy t-shirt scale
  (`text-xs/sm/base/md/lg/xl/2xl/3xl`) and arbitrary `text-[Npx]` values are being
  replaced by the §2 roles. Nearest-role map:
  `text-[13.5px]`→`text-row` · `text-[13px]`→`text-item` ·
  `text-[12.5px]`/`text-sm`→`text-body-sm` · `text-[11.5px]`→`text-meta` ·
  `text-[11px]`/`text-xs` (mono)→`text-mono-sm` · `text-base`→`text-body` or
  `text-row` · `text-md`→`text-card-title`. If nothing fits, that's a loop-step-4
  conversation (maybe the doc needs a role). The legacy scale itself is deleted
  only in the final cleanup step, so unmigrated screens keep working meanwhile.
