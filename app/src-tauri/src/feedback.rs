use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::kalaidoscope::{InstanceEntry, KalaidoscopeState};

const LOG_LINES: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackDiagnostics {
    app_version: String,
    os: &'static str,
    arch: &'static str,
    sidecar_phase: Option<String>,
    sidecar_log: Vec<String>,
}

#[tauri::command]
pub(crate) fn get_feedback_diagnostics(
    kalaidoscope_id: Option<String>,
    app: AppHandle,
) -> FeedbackDiagnostics {
    let mut sidecar_phase = None;
    let mut sidecar_log = Vec::new();
    if let (Some(id), Some(state)) = (kalaidoscope_id, app.try_state::<KalaidoscopeState>()) {
        match state.instances.lock().unwrap().get(&id) {
            Some(InstanceEntry::Starting) => sidecar_phase = Some("starting".to_string()),
            Some(InstanceEntry::Running(instance)) => {
                sidecar_phase = Some(instance.sidecar.status.lock().unwrap().phase.clone());
                sidecar_log = instance.sidecar.log.recent(LOG_LINES);
            }
            None => {}
        }
    }
    FeedbackDiagnostics {
        app_version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        sidecar_phase,
        sidecar_log,
    }
}
