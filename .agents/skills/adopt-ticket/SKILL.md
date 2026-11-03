---
name: adopt-ticket
description: Adopts a Linear ticket for new work — syncs main, creates a branch for the ticket from main, reads the ticket and the code it touches, then reports what is needed to begin and waits for confirmation before doing anything else.
disable-model-invocation: true
---

# Skill: Adopt Ticket

Use this skill when a human asks you to adopt a Linear ticket to start new work on. Input: a ticket identifier (`K-<n>`) or URL.

## Core Directives

1. **Human-directed git exception**: invoking this skill is explicit human direction to run exactly the git commands in steps 2–3. Nothing else: no commit, push, stash, reset, rebase, merge, or branch deletion.
2. **Stop on anything unexpected**: dirty working tree, failed pull, branch name already taken, ticket outside the `K-` workspace team. Report and stop; do not work around it.
3. **Never start work unprompted**: the skill ends at the report in step 5. Even when nothing blocks, say so and wait for an explicit go-ahead. Until then: edit no files, and write nothing to Linear (no status, assignee, label, or comment changes).
4. **Intent comes from humans**: the ticket description, its comments, and linked issues define the work. Do not expand it. A ticket's self-reported state is not authoritative; the code is.
5. **`AGENTS.md` still binds**: ambiguity, product / architecture / scope decisions, and the API-proposal gate are reported as things needed to begin, never resolved by assumption.

## Workflow

### 1. Read the ticket
- `get_issue` with `includeRelations: true`, then `list_comments`. View embedded screenshots with `extract_images` and attachments with `get_attachment`.
- Stop if the identifier does not start with `K-`.
- If the status is Done, Duplicate, or Not Needed, report it and stop before touching git.
- For blocking, blocked-by, parent, and related issues: fetch each just far enough to know its status and what it asks.

### 2. Sync main
- `git status --porcelain` must be empty, otherwise stop.
- `git switch main && git pull --ff-only`

### 3. Create the branch
- Branch name = the issue's `gitBranchName` from `get_issue`. If it is empty, stop and ask for a name.
- If the branch exists locally (`git branch --list <name>`) or on the remote (`git ls-remote --heads origin <name>`), stop and report: it is either earlier work or a PR to adopt with `adopt-pr`.
- `git switch -c <name>` (from the freshly pulled `main`; no upstream, no push).

### 4. Read the ground
- Read-only. Read `AGENTS.md`, plus `app/AGENTS.md` or `kalaidoscope/AGENTS.md` for the area the ticket touches.
- Read the code the ticket concerns. Establish what already exists, whether any of the ticket is already done, and whether its assumptions still hold.

### 5. Report, then stop
- **Ticket**: identifier, title, status, branch created.
- **The ask**: each requirement as the ticket states it, quoted or closely paraphrased, with no additions.
- **Current state**: what the code already does that is relevant, with `file:line`.
- **Needed to begin**: everything that must be settled first, each with what would settle it:
  - open blocking issues;
  - unanswered questions in the ticket or its comments;
  - every point with two reasonable readings: the options and your recommendation;
  - decisions `AGENTS.md` reserves for humans;
  - an API that must be proposed and signed off before it is built;
  - anything that can only be verified on the Mac.
- **Proposed first slice**: one or two lines. A proposal, not a plan you will follow.
- End with exactly one of:
  - `Nothing blocks starting — waiting for your go-ahead.`
  - `Blocked on the above — waiting for your answers.`

Then stop. Do nothing further until the human confirms.
