mod files;
mod kalaidoscope;
mod menu;
mod sidecar;

use tauri::RunEvent;

use crate::files::{classify_path, read_file_bytes};
use crate::kalaidoscope::{
    KalaidoscopeState, create_local_kalaidoscope, get_local_kalaidoscope_auth_token,
    get_local_kalaidoscope_status, start_local_kalaidoscope, stop_all_kalaidoscopes_on_exit,
    stop_local_kalaidoscope,
};
use crate::menu::{build_menu, handle_menu_event};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(KalaidoscopeState::default())
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            create_local_kalaidoscope,
            start_local_kalaidoscope,
            get_local_kalaidoscope_auth_token,
            get_local_kalaidoscope_status,
            stop_local_kalaidoscope,
            read_file_bytes,
            classify_path,
        ])
        .menu(build_menu)
        .on_menu_event(handle_menu_event)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                stop_all_kalaidoscopes_on_exit(app);
                // The sidecar kill above is synchronous, so cleanup is done.
                // Force a zero exit: without this the process exits non-zero on
                // macOS window-close, which `tauri dev`/`pnpm` report as
                // `[ELIFECYCLE] Command failed.`.
                std::process::exit(0);
            }
        });
}
