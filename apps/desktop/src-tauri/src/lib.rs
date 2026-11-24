mod downloads;
mod feedback;
mod files;
mod kalaidoscope;
mod llm;
mod menu;
mod sidecar;
mod updater;

use tauri::RunEvent;

use crate::downloads::download_to_file;
use crate::feedback::get_feedback_diagnostics;
use crate::files::{classify_path, read_file_bytes};
use crate::kalaidoscope::{
    KalaidoscopeState, create_local_kalaidoscope, delete_local_kalaidoscope,
    get_local_kalaidoscope_auth_token, get_local_kalaidoscope_status, start_local_kalaidoscope,
    stop_all_kalaidoscopes_on_exit, stop_local_kalaidoscope,
};
use crate::llm::{check_ollama_status, validate_llm_key};
use crate::menu::{build_menu, handle_menu_event};
use crate::updater::{PendingUpdate, check_for_update, install_pending_update};

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|_app| Ok(()))
        .manage(KalaidoscopeState::default())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            create_local_kalaidoscope,
            start_local_kalaidoscope,
            get_local_kalaidoscope_auth_token,
            get_local_kalaidoscope_status,
            stop_local_kalaidoscope,
            delete_local_kalaidoscope,
            read_file_bytes,
            classify_path,
            check_ollama_status,
            validate_llm_key,
            download_to_file,
            get_feedback_diagnostics,
            check_for_update,
            install_pending_update,
        ])
        .menu(build_menu)
        .on_menu_event(handle_menu_event);

    let mut context = tauri::generate_context!();
    if cfg!(any(dev, debug_assertions)) {
        context.config_mut().identifier.push_str(".dev");
    }

    let app = builder
        .build(context)
        .expect("error while building tauri application");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { code, .. } = event {
            stop_all_kalaidoscopes_on_exit(app);
            if code == Some(tauri::RESTART_EXIT_CODE) {
                return;
            }
            std::process::exit(0);
        }
    });
}
