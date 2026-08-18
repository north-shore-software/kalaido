---
title: "Fragment type 'Chat' when saving chat response is unclear"
status: "open"
author: "human"
created: "2026-08-17"
---

## Description
When saving a chat response as a fragment, the resulting fragment is given the type "Chat", which is unclear/ambiguous to users.

## Steps to Reproduce
1. Save a response from a chat as a fragment.
2. View the resulting fragment and observe its assigned type label.

## Expected Behavior
The fragment type name should be clear and intuitive for chat responses saved as fragments.

## Observed Behavior
The fragment type is labeled "Chat", which is unclear.

## Context / Relevant Code
- Affected UI/components: Save chat response as fragment feature / fragment type taxonomy
- Notes: Reported during chat-to-fragment flow testing.
