---
title: "Gemini model select box should be a dropdown and hidden behind 'Advanced' settings"
status: "open"
author: "human"
created: "2026-08-14"
---

## Description
The Gemini "model select" box is currently a plain text box rather than a dropdown menu. Additionally, model selection should be moved behind an "Advanced" section so that, by default, the interface only prompts for the API key.

## Steps to Reproduce
1. Navigate to the Gemini configuration / API key setup interface.
2. Observe the "model select" input element and default field display.

## Expected Behavior
- The "model select" field should be a dropdown menu.
- Model selection options should be hidden behind an "Advanced" section by default, asking only for the API key initially.

## Observed Behavior
- The "model select" field is a textbox.
- All options are displayed by default instead of being behind an "Advanced" toggle/section.

## Context / Relevant Code
- Affected files: None explicitly named by user
- Notes: User noted: "the gemini \"model select\" box is just a textbox - we need a dropdown. also, let's put all of that behind \"advanced\" - by default let's just ask for api key"
