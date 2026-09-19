use tauri::Manager;
use window_vibrancy::{
    apply_acrylic, apply_blur, apply_mica, apply_vibrancy, NSVisualEffectMaterial,
    NSVisualEffectState,
};

/// The native effect behind the window: "vibrancy" (macOS), "mica", "acrylic"
/// or "blur" (Windows), or "none" (Linux, where the window stays opaque).
struct Backdrop(&'static str);

#[tauri::command]
fn backdrop(state: tauri::State<Backdrop>) -> &'static str {
    state.0
}

/// Each call errors on platforms it doesn't support, so try them in order.
/// The window is transparent only on macOS and Windows (tauri.<os>.conf.json).
fn apply_backdrop(window: &tauri::WebviewWindow) -> &'static str {
    let sidebar = apply_vibrancy(
        window,
        NSVisualEffectMaterial::Sidebar,
        Some(NSVisualEffectState::Active),
        None,
    );
    if sidebar.is_ok() {
        return "vibrancy";
    }
    if apply_mica(window, None).is_ok() {
        return "mica";
    }
    if apply_acrylic(window, Some((18, 18, 18, 125))).is_ok() {
        return "acrylic";
    }
    if apply_blur(window, Some((18, 18, 18, 125))).is_ok() {
        return "blur";
    }
    "none"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let mut effect = "none";
            if let Some(window) = app.get_webview_window("main") {
                effect = apply_backdrop(&window);
            }
            app.manage(Backdrop(effect));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backdrop])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
