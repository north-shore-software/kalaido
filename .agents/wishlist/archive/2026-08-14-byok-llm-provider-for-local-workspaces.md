---                                                                                                                                                                                 
 title: "Decouple workspace storage from LLM provider (BYOK API keys for local workspaces)"                                                                                          
 status: "specified"                                                                                                                                                                 
 author: "human"                                                                                                                                                                     
 created: "2026-08-14"                                                                                                                                                               
 expanded: "2026-08-14"                                                                                                                                                              
 ---                                                                                                                                                                                 
                                                                                                                                                                                     
 ## Summary                                                                                                                                                                          
 Decouple workspace storage location from LLM inference provider selection. Local vs. cloud workspace designation defines strictly where data is stored on disk/cloud. Enable local  
 workspaces to use cloud LLM providers under a "Bring Your Own API Key" (BYOK) model as a first-class option, initially starting with **Google Gemini**, alongside the existing local
 Ollama option.                                                                                                                                                                      
                                                                                                                                                                                     
 ## Motivation / Use Case                                                                                                                                                            
 Currently, local workspaces are restricted to using local Ollama models. Users who prefer local data storage on disk still want to use powerful cloud LLM providers (e.g., Google   
 Gemini) by supplying their own API keys, without having to host local models.                                                                                                       
                                                                                                                                                                                     
 ## Desired Working End State                                                                                                                                                        
                                                                                                                                                                                     
 1. **Storage vs. Inference Decoupling**:                                                                                                                                            
    - **Workspace Storage Type** (local file / cloud / local dev net) continues to control solely where the database and workspace files reside — unchanged by this item.            
    - **LLM Provider** becomes a first-class, per-workspace property for local workspaces: either local Ollama or Google Gemini (BYOK). Cloud-storage workspaces are untouched by    
 this item — they continue to use Kalaido's own managed Gemini key, with no user-facing provider choice.                                                                             
                                                                                                                                                                                     
 2. **Provider is fixed for a workspace's lifetime**:                                                                                                                                
    - Chosen once during workspace creation, the same way storage type already is.                                                                                                   
    - There is no "switch provider" action later — changing provider means creating a new workspace. (Matches existing backend behavior, where the active model set is seeded once   
 and treated as authoritative.)                                                                                                                                                      
    - Within the chosen provider, the API key (Gemini only) and per-role model assignments **are** editable later — see point 5.                                                     
                                                                                                                                                                                     
 3. **Workspace Setup Flow (`KalaidoscopeSetup`)**, for local workspaces only:                                                                                                       
    - Alongside the existing name/icon/storage fields, a provider choice:                                                                                                            
      - **Local Ollama**: existing flow, unchanged.                                                                                                                                  
      - **Google Gemini (BYOK)**: prompts for a Gemini API key and a model.                                                                                                          
        - Model selection defaults to one model applied to all 5 generation roles (chat, refinement, projection/reflection, lens distillation, colour scoring), picked from a        
 recommended list or entered as free text.                                                                                                                                           
        - An "advanced: customize per role" disclosure lets the user assign a different model to each of the 5 roles individually, mirroring how the built-in cloud model set already
 varies model by role.                                                                                                                                                               
    - On save, the API key is validated with a live test call before the workspace is created. A failing key blocks creation with an explanation (invalid key, no access to the      
 chosen model, quota, etc.) — never saved optimistically.                                                                                                                            
                                                                                                                                                                                     
 4. **API Key & Provider Persistence**:                                                                                                                                              
    - Provider choice, Gemini API key, and per-role model assignments are stored in the workspace's own local PocketBase database (per-workspace, not global).                       
    - Stored in plaintext, consistent with how the rest of the app already persists local settings/config — no OS keychain or other secret-store dependency introduced by this item. 
                                                                                                                                                                                     
 5. **Workspace-Specific Settings Page** (new — no per-workspace settings UI exists today; "Manage Kalaidoscopes" is currently read-only):                                           
    - For a Gemini-provider workspace: view/update/clear the stored API key (revalidated live on every change, same as setup), and change per-role model assignments.                
    - For an Ollama-provider workspace: existing model selection, now scoped to that workspace rather than app-global as it is today.                                                
    - No control to switch provider itself — see point 2.                                                                                                                            
                                                                                                                                                                                     
 6. **Workspace List & Switcher**:                                                                                                                                                   
    - Show a small provider badge (Ollama / Gemini) next to each workspace, in both the "Manage Kalaidoscopes" settings list and the workspace switcher — provider is now a          
 permanent, distinguishing property of a workspace.                                                                                                                                  
                                                                                                                                                                                     
 7. **Backend Execution**:                                                                                                                                                           
    - When processing chat, refinement, projection/reflection, lens distillation, or colour-scoring generation, the workspace's backend resolves model + provider from its own stored
 config (not a global/env-seeded value) and dispatches to Ollama or Gemini accordingly.                                                                                              
    - If a Gemini call fails at runtime (revoked/expired key, quota, network), the error surfaced to the user distinguishes "your API key stopped working — update it in Settings"   
 from generic/transient failures, rather than a generic failure message.      

                                                                                                                                                                               
 ## Verified Technical Constraints                                                                                                                                                   
 - A real multi-provider abstraction already exists in `kalaidoscope/llm/` (`Provider` interface, `ModelSet` → `Role` → model table, `registry.go`, `selector.go`), and a working    
 Gemini provider already exists (`kalaidoscope/gemini/gemini.go`) — this item exposes and extends that, rather than building provider dispatch from scratch.                         
 - The existing `kalaidoscope_config` PocketBase collection has `DisableWriteOperations: true` (superuser-only writes) and only a `model_set` field today. A client-writable path    
 (new collection or custom route) and new fields (provider, API key, per-role model map) are required — not just new columns on an already-writable table.                           
 - The Gemini provider currently reads its key via `os.Getenv("GEMINI_API_KEY")` — a per-workspace, DB-backed, live-rotatable key requires changing credential resolution to read    
 from the workspace's own database rather than process environment.                                                                                                                  
 - The locally-spawned sidecar process currently receives zero environment variables from Tauri (`envs: vec![]` in `spawn.rs`) — there is no existing plumbing to get a per-workspace
 secret into that process at all today.                                                                                                                                              
 - `model-radio-list.tsx` and the "Local AI" Settings section are app-global (one Ollama model choice for the whole app via a shared JSON settings file) and Ollama-shaped (name +   
 byte size) — a per-workspace, provider-aware settings UI is new surface, not an extension of what exists.                                                                           
 - Ollama itself is not bundled/spawned by Kalaido — it's a separately-running external service the app expects at `localhost:11434`; this item doesn't change that.                 
                                                                                                                                                                                     
 ## Acceptance Criteria                                                                                                                                                              
 - [ ] At creation, a local workspace can choose **Ollama** or **Google Gemini (BYOK)** as its provider; the choice is permanent for that workspace.                                 
 - [ ] Choosing Gemini requires an API key and a model (default: one model for all roles, with an advanced per-role override), and the key is validated live before the workspace is 
 created.                                                                                                                                                                            
 - [ ] Provider, key, and per-role model assignments are stored in that workspace's own local PocketBase database, in plaintext.                                                     
 - [ ] A per-workspace Settings page lets the user view/update/clear the Gemini API key and change per-role model assignments (each change re-validated live) — but not switch       
 provider.                                                                                                                                                                           
 - [ ] Chat, refinement, projection/reflection, lens distillation, and colour-scoring generation all execute via Gemini when the workspace is configured for it.                     
 - [ ] A revoked/expired-key failure at runtime is distinguishable, in the UI, from a generic/transient failure.                                                                     
 - [ ] The workspace list and switcher show which provider each workspace uses.                                                                                                      
 - [ ] Cloud-storage workspace behavior is unchanged by this item.                                       