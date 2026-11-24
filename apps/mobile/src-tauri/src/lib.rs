#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|_app| Ok(()));

    let mut context = tauri::generate_context!();
    if cfg!(any(dev, debug_assertions)) {
        context.config_mut().identifier.push_str(".dev");
    }

    let app = builder
        .build(context)
        .expect("error while building tauri application");

    app.run(|_, _| {});
}
