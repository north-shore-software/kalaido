---
title: "onboarding-organizing declares :ingestId but never reads it"
status: "open"
author: "agent"
created: "2026-09-17"
---

## Description
`onboardingOrganizingRoute` (`app/src/features/onboarding/pages/OnboardingOrganizing.tsx`) is registered at `/onboarding/organizing/:ingestId`, and both callers (`OnboardingImport.tsx`, `Main.tsx`) pass an `ingestId`, but the page never reads the param — it follows `usePipelineProgress()` instead. The param is either dead (drop it from the path and the route contract) or the page should scope its progress to it.

## Steps to Reproduce
1. Search the page for `ingestId`: only the route's `path` mentions it.

## Expected Behavior
A route param is read by the screen that declares it, or is not declared.

## Observed Behavior
The param is required by the URL and by `RouteContracts` yet has no effect on the screen.
