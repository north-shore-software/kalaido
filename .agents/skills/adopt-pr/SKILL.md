---
name: adopt-pr
description: Adopts a pull request opened by an async coding agent — syncs main, checks out the PR branch locally tracking the remote, rebases it onto main, then reviews the code against the PR description and its linked Linear issue.
disable-model-invocation: true
---

# Skill: Adopt PR

Use this skill when a human asks you to adopt a PR opened by an async coding agent. Input: a PR number or URL.

## Core Directives

1. **Human-directed git exception**: invoking this skill is explicit human direction to run exactly the git commands in steps 1–3, including the commits needed to finish the rebase. Nothing else: no push, merge, stash, reset, or branch deletion.
2. **Stop on anything unexpected**: dirty working tree, missing branch, fork PR, failed pull. Report and stop; do not work around it.
3. **Resolve rebase conflicts in favour of intent**: every resolution must preserve what the PR description and Linear issue intend, while keeping what `main` changed. If both cannot be kept, stop and ask.
4. **Review, do not fix**: outside conflict resolution, report findings only. Edit no files.
5. **Intent comes from humans**: the PR description and Linear issue define what the change should do. Judge the diff against that, not against the agent's own commit messages or summary.

## Workflow

### 1. Gather the PR
- `gh pr view <pr> --json number,title,body,url,headRefName,baseRefName,isCrossRepository,commits,comments`
- Stop if `isCrossRepository` is true or `baseRefName` is not `main`.
- Find the Linear issue identifier (`K-<n>`) in the PR title, body, branch name or comments. Fetch it via the Linear MCP (`get_issue`, plus `list_comments`). If none exists, say so and review against the PR description alone.

### 2. Sync main
- `git status --porcelain` must be empty, otherwise stop.
- `git switch main && git pull --ff-only`

### 3. Check out and rebase
- `git fetch origin <headRefName>`
- If a local branch `<headRefName>` already exists, stop and report; do not overwrite it.
- `git switch -c <headRefName> --track origin/<headRefName>`
- `git rebase main`. For each conflict:
  - Read both sides and the `main` commits that caused it.
  - Resolve so the PR's intent survives on top of `main`'s changes, then `git add <files>` and `git rebase --continue`.
  - If the intent cannot be preserved without dropping or overriding something from `main`, leave the rebase in progress, explain the conflict, and ask.
- Report: commits rebased, each conflict and how it was resolved and why, and that the local branch now diverges from its remote (pushing is the human's call).

### 4. Review
- Read the full diff (`git diff main...HEAD`) and every touched file in context, not just the hunks.
- Check against the stated intent:
  - **Does it do what was asked?** Each requirement from the PR / issue: met, partially met, or missing.
  - **Scope**: anything the PR does that nobody asked for.
  - **Correctness**: bugs, edge cases, error handling, concurrency, data/schema impact.
  - **Conflict resolutions**: confirm each one preserved both the PR's intent and `main`'s changes.
  - **Repo rules**: violations of `AGENTS.md` (and `app/AGENTS.md` for UI changes) — comments added, tests added unasked, unapproved architecture or product decisions.
- Verify behaviour by running it where possible (relevant tests or checks for the touched area). State what you could not run.

### 5. Report
- Summary: PR, Linear issue, rebase result.
- Requirements checklist.
- Findings, most severe first, each with `file:line`, what is wrong, and why it matters.
- Open questions for the human.
