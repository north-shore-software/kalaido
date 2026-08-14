---
title: "Clean up sign in/up page options and remove name field on signup"
status: "open"
author: "human"
created: "2026-08-14"
---

## Description
The sign in/up page contains redundant controls for toggling between sign in and sign up modes, and collects an unnecessary "Name" field during signup.

## Steps to Reproduce
1. Go to the sign in/up page.
2. Observe the toggle at the top for "sign in" and "sign up", and the link underneath for "sign up".
3. Observe the input fields collected on signup.

## Expected Behavior
- Do not include both the top toggle and the link underneath for "sign up" (we don't need both).
- Do not collect "Name" on signup (email is enough).

## Observed Behavior
- Page has both a toggle at the top for "sign in" and "sign up" and a link underneath for "sign up".
- "Name" is collected on signup.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User noted: "the sign in/up page has a toggle at the top for "sign in" and "sign up", but it also has a link underneath for "sign up". we don't need both. also, we don't need Name, which is collected on signup. email is enough."
