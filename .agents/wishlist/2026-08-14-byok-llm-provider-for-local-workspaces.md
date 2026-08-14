---
title: "Decouple workspace storage from LLM provider (BYOK API keys for local workspaces)"
status: "specified"
author: "human"
created: "2026-08-14"
expanded: "2026-08-14"
---

## Summary
Decouple workspace storage location from LLM inference provider selection. Local vs. cloud workspace designation defines strictly where data is stored on disk/cloud. Enable local workspaces to use cloud LLM providers under a "Bring Your Own API Key" (BYOK) model as a first-class option—initially starting with **Google Gemini**.

## Motivation / Use Case
Currently, local workspaces are restricted to using local Ollama models. Users who prefer local data storage on disk still want to use powerful cloud LLM providers (e.g., Google Gemini) by supplying their own API keys without having to host local models.

## Desired Working End State

1. **Storage vs. Inference Decoupling**:
   - **Workspace Storage Type (Local vs. Cloud)**: Controls solely where the database and workspace files reside.
   - **LLM Provider Selection**: Configured per-workspace as a first-class property. Supports local Ollama or Google Gemini (BYOK).

2. **Workspace Setup Flow (`KalaidoscopeSetup`)**:
   - During workspace creation, under provider configuration, users can choose:
     - **Local Ollama**: Existing flow (uses local Ollama sidecar/models).
     - **Google Gemini (BYOK)**: Prompts for a Google Gemini API Key and model selection.
   - Model selection for Gemini provides a dropdown/list of recommended Gemini models (e.g. `gemini-2.5-flash`, `gemini-2.5-pro`) along with a text input for entering custom model names.

3. **API Key & Provider Persistence**:
   - The selected provider (Ollama vs. Gemini), Gemini API key, and model string are stored directly inside the workspace's local PocketBase database.
   - Keys are kept self-contained within the workspace database rather than global OS keychains or plain text configuration files.

4. **Workspace-Specific Settings Page**:
   - A workspace-specific configuration section in Settings allows users to:
     - Switch the active AI provider between Ollama and Google Gemini.
     - View, update, or clear the stored Gemini API key.
     - Change or enter the default model for that workspace.

5. **Backend Execution**:
   - When processing chat, refinement, projection, or reflection generations, the workspace's backend checks its database settings. If configured for Gemini, it uses the stored Gemini API key to make requests to Google's Gemini API directly.

## Verified Technical Constraints
- Local PocketBase database schema can store workspace-level AI provider settings and API keys.
- `models.ts` and chat/refinement APIs can dispatch generation requests to either Ollama or Google Gemini REST/SDK endpoints based on the workspace setting.
- Model selection UI (`model-radio-list.tsx`) can render Gemini model options alongside/instead of Ollama models depending on active provider.
- No global system keychain integration required.

## Acceptance Criteria
- [ ] Local workspaces can select between **Ollama** and **Google Gemini** as their AI provider.
- [ ] Setting up a new workspace allows selecting Google Gemini, entering a Gemini API Key, and picking/entering a Gemini model.
- [ ] API keys and provider preferences are stored inside the local PocketBase database for that workspace.
- [ ] Workspace Settings permits changing the provider, updating the Gemini API key, and selecting models.
- [ ] Generation endpoints (chat, refinements, reflections, projections) execute using Google Gemini when configured for BYOK.
