# UX Design Brief: Reworked Onboarding Experience

**Project**: Kalaido Onboarding Rework  
**Target File / Location**: `kalaido/.agents/plans/onboarding/required-screens.md`  
**Reference Specs**: `2026-08-14-rework-onboarding-initial-choices.md`, `onboarding-state-diagram.md`  
**Audience**: UX / UI Designers, Product Designers, Frontend Engineers  

---

## 1. Project Background & Objective

### Objective
Redesign the first-run and returning-user onboarding experience for Kalaido by introducing a clean, 3-choice landing screen:
1. **Log in to Cloud**
2. **Create New Workspace**
3. **Restore Workspace** (from a backup `.zip` file)

### Current Pain Points
Currently, returning cloud users and users with existing workspace backup files are forced to navigate through the workspace creation screen first before accessing sign-in or restoration. This causes unnecessary friction and confusion.

### Design Goals
* **Direct Intent Paths**: Give every user an immediate, single-click entry route tailored to their intent.
* **Distinct Terminology**:
  * **Backup / Restore** = Whole-workspace `.zip` file archive operations (pre-workspace / setup level).
  * **Import / Export** = Content-level data sync within an already-open workspace (Connections page — untouched by this feature).
* **Frictionless Navigation**: Clear top-left "Back" buttons on every sub-screen returning to the choice landing view.
* **Contextual In-line Gating**: When a user picks Cloud Storage while signed out during workspace creation, gate authentication inline without bouncing them away or losing their entered form data.

---

## 2. Core User Personas & Entry Scenarios

| Persona / User Story | Primary Intent | Expected Flow |
| :--- | :--- | :--- |
| **First-Time User** | Wants to quickly create a new local or cloud workspace. | Clicks **Create New Workspace** $\rightarrow$ Fills out name & icon $\rightarrow$ Chooses Local or Cloud storage $\rightarrow$ Opens immediately. |
| **Returning Cloud User** | Has existing cloud workspaces stored server-side. | Clicks **Log in to Cloud** $\rightarrow$ Signs in once $\rightarrow$ Views list of all cloud workspaces $\rightarrow$ Clicks to open any workspace. |
| **User with Backup File** | Has a `.zip` workspace archive from another device. | Clicks **Restore Workspace** $\rightarrow$ Picks file via OS dialog $\rightarrow$ Opens workspace (or resolves duplicate name if needed). |

---

## 3. Screen Specs & Wireframe Guidance

---

### Screen 1: Initial Onboarding Landing Screen
**Purpose**: Primary landing screen shown whenever no workspace is currently open or active (`no_kalaidoscopes_available`).

#### Layout & Layout Hierarchy
* **Header Area**:
  * Kalaido logo & brand mark.
  * Welcome Title: *"Welcome to Kalaido"* or *"Get Started with Kalaido"*.
  * Subtitle: *"Choose how you'd like to set up your workspace."*
* **Main Content Area (3 Primary Action Cards)**:
  * **Card 1 — Log in to Cloud**:
    * *Icon*: Cloud / Account user icon.
    * *Title*: **Log in to Cloud**
    * *Description*: *"Access your existing cloud workspaces and sync across devices."*
    * *Primary Action*: Navigates to Flow 1 (Dedicated Login Screen or directly to Cloud Workspaces List if already signed in).
  * **Card 2 — Create New Workspace**:
    * *Icon*: Plus / Sparkle icon.
    * *Title*: **Create New Workspace**
    * *Description*: *"Start fresh with a brand new local or cloud workspace."*
    * *Primary Action*: Navigates to Flow 2 (`KalaidoscopeSetup`).
  * **Card 3 — Restore Workspace**:
    * *Icon*: File archive / Folder upload icon.
    * *Title*: **Restore Workspace**
    * *Description*: *"Restore a whole-workspace backup from a `.zip` archive file."*
    * *Primary Action*: Launches native OS file picker (`openFilePicker`).

#### States & Variations
* **Default State**: 3 cards rendered side-by-side (desktop) or stacked vertically (tablet/compact).
* **Hover / Focus**: Subtle border glow and lift effect on action cards.
* **Error Banner State**: If a selected `.zip` archive is corrupt or invalid during Restore, an inline dismissible banner appears at the top of the card container: *"Unable to restore workspace: Invalid or corrupted backup file."*

---

### Screen 2: Dedicated Login Screen (Flow 1)
**Purpose**: Isolated authentication view for users selecting "Log in to Cloud".

#### Layout & Visual Guidance
* **Navigation Bar**:
  * Top-left **"← Back"** button returning to the Initial Onboarding Landing Screen.
* **Centered Auth Container**:
  * Title: *"Sign in to Kalaido Cloud"*
  * Reuses existing `AuthForm` (Email/Password fields, Sign In / Sign Up tabs) and `OAuthButtons` (Google, GitHub, etc.).
* **Behavior & Error Guidance**:
  * **Inline Error**: Rendered directly inside `AuthForm` on failed credentials (e.g. *"Invalid email or password"*). Entered text is preserved.
  * **Success Behavior**: Eagerly fetches user's cloud workspaces and transitions smoothly to **Cloud Workspaces List Screen**.

---

### Screen 3: Cloud Workspaces List Screen (Flow 1)
**Purpose**: Displays all merged cloud workspaces owned by the authenticated user.

#### Layout & Visual Guidance
* **Navigation Bar**:
  * Top-left **"← Back"** button returning to the Initial Onboarding Landing Screen.
* **Content Header**:
  * Title: *"Your Cloud Workspaces"*
  * Subtitle: *"Select a workspace to open, or create a new one."*
* **Workspace Grid / List**:
  * Cards displaying workspace icon, name, and last modified date.
  * Clicking any card attempts to open the workspace.
* **Secondary Action Button**:
  * Prominent button: **"+ Create New Workspace"** — Navigates to Workspace Setup Screen (`KalaidoscopeSetup`), already past the sign-in gate.
* **States**:
  * **Loading Skeleton**: Shown while `listCloudKalaidoscopes()` fetches workspaces.
  * **Network Error Toast/Banner**: Shown inline if a selected cloud workspace fails to load (e.g. user is offline): *"Unable to connect. Please check your internet connection and try again."*

---

### Screen 4: Workspace Setup Screen (`KalaidoscopeSetup`) (Flow 2)
**Purpose**: Form to configure and launch a new workspace.

#### Layout & Visual Guidance
* **Navigation Bar**:
  * Top-left **"← Back"** button returning to originating screen (Landing Screen or Cloud Workspaces List Screen).
* **Form Layout**:
  * **Workspace Name**: Text input with placeholder *"e.g. My Research Workspace"*.
  * **Icon Selector**: Grid of selectable icons/emojis.
  * **Storage Mode Selection (Radio / Segmented Switch)**:
    * **Local Storage**: *"Stored on this device only."*
    * **Cloud Storage**: *"Synced to Kalaido Cloud."*
* **Primary CTA**: **"Create Workspace"** button.

---

### Screen 5: Inline Sign-in Gate (Flow 2 Sub-State)
**Purpose**: Contextual authentication prompt rendered when a user selects "Cloud Storage" while signed out during workspace creation.

#### Layout & Visual Guidance
* **Framing / Header**:
  * Banner heading: *"Sign in to store this workspace in the cloud"*
  * Renders in-place within the setup container (does NOT redirect to Flow 1's list or Settings).
* **Components**:
  * Embedded `AuthForm` + `OAuthButtons`.
* **Actions**:
  * **"Cancel" / "Back to Setup"**: Closes inline gate and returns to Workspace Setup form with entered name & icon preserved.
  * **On Sign-In Success**: Resumes workspace creation automatically and opens the new cloud workspace.

---

### Screen 6: Duplicate Workspace Warning Modal (Flow 3)
**Purpose**: Confirmation modal when a restored `.zip` archive's ID collides with an existing local workspace.

#### Visual Guidance & Copy
* **Modal Overlay**: Centered dialog backdrop.
* **Icon**: Warning / Information triangle icon.
* **Title**: *"Workspace Already Exists"*
* **Body Copy**: *"A local workspace named **'[Existing Workspace Name]'** already exists on this device. Would you like to restore this backup as a new copy?"*
* **Action Buttons**:
  * **Primary Action**: **"Restore as New Copy"** (Assigns a new unique ID, extracts files, and opens workspace).
  * **Secondary Action**: **"Cancel"** (Aborts restore and returns to Landing Screen).

---

### Screen 7: Manage Kalaidoscopes Kebab Menu *(Companion Feature in Settings)*
**Purpose**: Per-workspace backup action inside Settings $\rightarrow$ Manage Kalaidoscopes.

#### Visual Guidance & Logic
* **Row Component (`KalaidoscopeRow`)**:
  * Displays workspace name, icon, type badge (`local_file`, `cloud`, or `local_net`).
  * Adds an overflow kebab icon (**`⋮`**) on the right end of the row.
* **Overflow Menu Items**:
  * **"Back up..."**
    * *Visibility*: Visible and enabled **only** for `local_file` workspaces.
    * *Behavior*: Opens native save location dialog (`saveFilePicker`) to export `.zip` backup archive.
    * *Hidden/Disabled*: Hidden for `cloud` and `local_net` workspace rows.

---

## 4. Navigation & Flow Matrix

```
[ Launch App / No Active Workspace ]
               │
               ▼
   [ Initial Landing Screen ]
     ├── 1. "Log in to Cloud" ────► (Signed In?) ──► [ Cloud Workspaces List ]
     │                                    │                      │
     │                                    NO                     │ (Click "+ Create")
     │                                    ▼                      ▼
     │                           [ Login Screen ] ────► [ Workspace Setup ]
     │                                                           │
     ├── 2. "Create New Workspace" ──────────────────────────────┤
     │                                                           │ (Choose Cloud & Signed Out)
     │                                                           ▼
     │                                                [ Inline Auth Gate ]
     │
     └── 3. "Restore Workspace" ──► [ Native OS File Picker ]
                                           │
                                           ▼ (If Duplicate ID)
                                  [ Collision Warning Modal ]
```

---

## 5. Summary Checklist for UX / UI Designer

- [ ] **Initial Landing Screen**: Design clean header and 3 action cards (**Log in to Cloud**, **Create New Workspace**, **Restore Workspace**).
- [ ] **Dedicated Login Screen**: Wireframe standalone auth view with top-left "← Back" button.
- [ ] **Cloud Workspaces List**: Design workspace card layout, skeleton loading state, offline error alert, and secondary "+ Create New Workspace" CTA button.
- [ ] **Workspace Setup (`KalaidoscopeSetup`)**: Ensure form supports top-left "← Back" button returning to originating screen.
- [ ] **Inline Auth Gate**: Design contextual inline sign-in card inside Setup view with explicit "Cancel" button.
- [ ] **Duplicate Warning Modal**: Wireframe collision dialog with clear copy naming the conflicting workspace and primary "Restore as New Copy" action.
- [ ] **Settings Backup Overflow Menu**: Design kebab menu dropdown on `KalaidoscopeRow` for `local_file` workspaces.
