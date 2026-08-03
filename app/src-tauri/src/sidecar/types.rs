use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::CommandChild;
use tokio::sync::Notify;

/// Bundle of state the host needs to track one running sidecar process:
/// the child handle (for sending kill) and an awaitable termination signal
/// set by the per-child supervisor task.
pub(crate) struct SidecarHandle {
    pub child: CommandChild,
    pub terminated: Arc<Notify>,
}

/// Live status of a sidecar process. Mirrored into a frontend Zustand slice
/// via events so the UI can show what's happening.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SidecarStatus {
    pub phase: String,
    pub id: Option<String>,
    pub message: Option<String>,
    pub port: Option<u16>,
}

impl SidecarStatus {
    pub fn new(phase: &str, id: Option<&str>, message: Option<String>) -> Self {
        Self {
            phase: phase.to_string(),
            id: id.map(|s| s.to_string()),
            message,
            port: None,
        }
    }

    pub fn with_port(
        phase: &str,
        id: Option<&str>,
        message: Option<String>,
        port: Option<u16>,
    ) -> Self {
        Self {
            phase: phase.to_string(),
            id: id.map(|s| s.to_string()),
            message,
            port,
        }
    }
}

pub(crate) struct SidecarInstance {
    pub handle: SidecarHandle,
    pub captured_lines: Arc<Mutex<Vec<String>>>,
    pub status: Arc<Mutex<SidecarStatus>>,
}
