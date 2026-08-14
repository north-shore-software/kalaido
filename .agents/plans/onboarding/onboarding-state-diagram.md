# Onboarding Flow Diagram (User-Facing)

This document shows the user-facing onboarding flows for Kalaido, detailing the screens users see, the actions they take, and the decisions they make.

---

## User Flowchart

```mermaid
flowchart TD
    %% Entry Point & Onboarded Check
    START(["Launch App"]) --> CHK_ONBOARDED{"Have they already onboarded?"}

    CHK_ONBOARDED -- "Yes (Active / Resumable Workspace)" --> OPENED(["Open Last Workspace (Main App View)"])
    CHK_ONBOARDED -- "No (First Run / No Active Workspace)" --> LANDING

    %% Landing Screen
    LANDING["Landing Screen
    'Welcome! Choose how to get started:'
    • Log in to Cloud
    • Create New Workspace
    • Restore Workspace"]

    %% Option 1: Log in to Cloud
    LANDING -->|"Select 'Log in to Cloud'"| CHK_LOGIN{"Is User Already Signed In?"}
    
    CHK_LOGIN -- "No" --> LOGIN_SCREEN["Login Screen
    (Email / Password or OAuth)"]
    LOGIN_SCREEN -->|"Click 'Back'"| LANDING
    LOGIN_SCREEN -->|"Submit Login"| DO_LOGIN{"Login Successful?"}
    
    DO_LOGIN -- "No" --> LOGIN_ERR["Show Login Error Message
    (Stay on Login Screen)"]
    LOGIN_ERR --> LOGIN_SCREEN
    
    DO_LOGIN -- "Yes" --> CLOUD_LIST
    CHK_LOGIN -- "Yes" --> CLOUD_LIST

    CLOUD_LIST["Cloud Workspaces List
    • View list of cloud workspaces
    • Select a workspace to open
    • Or click 'Create New Workspace'"]
    
    CLOUD_LIST -->|"Click 'Back'"| LANDING
    CLOUD_LIST -->|"Select a Workspace"| TRY_OPEN{"Workspace Opens?"}
    TRY_OPEN -- "Yes" --> OPENED
    TRY_OPEN -- "No (Network Error)" --> OPEN_ERR["Show Connection Error
    (Stay on List View)"]
    OPEN_ERR --> CLOUD_LIST
    
    CLOUD_LIST -->|"Click 'Create New Workspace'"| SETUP_FROM_LIST

    %% Option 2: Create New Workspace
    LANDING -->|"Select 'Create New Workspace'"| SETUP_DIRECT["Workspace Setup Screen
    (Enter Name, Choose Icon & Storage Mode)"]
    
    SETUP_DIRECT -->|"Click 'Back'"| LANDING
    SETUP_FROM_LIST["Workspace Setup Screen
    (Enter Name, Choose Icon & Storage Mode)"] -->|"Click 'Back'"| CLOUD_LIST

    SETUP_DIRECT -->|"Select 'Local Storage' & Submit"| OPENED
    SETUP_FROM_LIST -->|"Select 'Local Storage' & Submit"| OPENED

    SETUP_DIRECT -->|"Select 'Cloud Storage' & Submit"| CHK_CLOUD_AUTH{"Signed In?"}
    SETUP_FROM_LIST -->|"Select 'Cloud Storage' & Submit"| CHK_CLOUD_AUTH

    CHK_CLOUD_AUTH -- "Yes" --> OPENED
    CHK_CLOUD_AUTH -- "No" --> INLINE_GATE["Inline Sign-in Gate
    'Sign in to store this workspace in cloud'"]

    INLINE_GATE -->|"Click 'Cancel'"| SETUP_DIRECT
    INLINE_GATE -->|"Submit Sign-in"| DO_INLINE_AUTH{"Sign-in Successful?"}
    
    DO_INLINE_AUTH -- "No" --> INLINE_ERR["Show Error Message
    (Stay on Sign-in Screen)"]
    INLINE_ERR --> INLINE_GATE
    
    DO_INLINE_AUTH -- "Yes" --> OPENED

    %% Option 3: Restore Workspace
    LANDING -->|"Select 'Restore Workspace'"| FILE_PICKER["File Picker
    (Choose .zip backup file)"]

    FILE_PICKER -->|"Cancel / Close File Picker"| LANDING
    FILE_PICKER -->|"Select File"| CHK_FILE{"Is Backup File Valid?"}

    CHK_FILE -- "Corrupt / Invalid" --> FILE_ERR["Show File Error Message
    (Stay on Landing Screen)"]
    FILE_ERR --> LANDING

    CHK_FILE -- "Valid Backup" --> CHK_DUP{"Workspace Already Exists Locally?"}

    CHK_DUP -- "No" --> OPENED
    CHK_DUP -- "Yes" --> DUP_MODAL["Duplicate Workspace Warning
    'A workspace with this ID already exists.
    Restore as a new copy?'"]

    DUP_MODAL -->|"Click 'Cancel'"| LANDING
    DUP_MODAL -->|"Click 'Restore as New Copy'"| OPENED
```

---

## User Screens & Decisions Summary

| Screen / Step | What the User Sees / System Check | Decisions / Actions Available | Next Destination |
| :--- | :--- | :--- | :--- |
| **0. Entry Check** | System checks if user has previously onboarded | • **Yes**: Resumable workspace exists<br>• **No**: First run or no active workspace | Open Last Workspace<br>Landing Screen |
| **1. Landing Screen** | Welcome message with 3 primary action cards | • Choose **Log in to Cloud**<br>• Choose **Create New Workspace**<br>• Choose **Restore Workspace** | Login Screen / Cloud List<br>Workspace Setup Screen<br>File Picker |
| **2. Login Screen** | Email/Password inputs & OAuth buttons | • Submit credentials<br>• Click **Back** | Cloud Workspaces List (on success)<br>Landing Screen |
| **3. Cloud Workspaces List** | Cards for each of the user's cloud workspaces + a "Create New Workspace" option | • Click a workspace to open it<br>• Click **Create New Workspace**<br>• Click **Back** | Opened Workspace<br>Workspace Setup Screen<br>Landing Screen |
| **4. Workspace Setup** | Form to enter name, pick an icon, and choose Local vs. Cloud storage | • Submit with Local Storage<br>• Submit with Cloud Storage<br>• Click **Back** | Opened Workspace<br>Inline Sign-in (if signed out) / Opened Workspace<br>Landing Screen or Cloud List |
| **5. Inline Sign-in Gate** | Sign-in form framed as "Sign in to store this workspace in cloud" | • Submit sign-in<br>• Click **Cancel** | Workspace Created & Opened (on success)<br>Workspace Setup Screen (inputs kept) |
| **6. Restore File Picker** | Native OS file picker dialog | • Select a `.zip` file<br>• Cancel dialog | Validation check<br>Landing Screen |
| **7. Duplicate Warning Modal** | Warning dialog stating a workspace with the same ID already exists | • Click **Restore as New Copy**<br>• Click **Cancel** | Restored as new copy & Opened<br>Landing Screen |
