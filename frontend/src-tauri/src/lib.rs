use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
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

/// Where the backend answers, and the process to stop on exit when this app
/// started it.
struct Backend {
    url: String,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn backend_url(state: tauri::State<Backend>) -> String {
    state.url.clone()
}

/// Development: the backend runs separately (uvicorn --reload) on port 8000,
/// so code changes apply without rebuilding the bundled executable.
#[cfg(debug_assertions)]
fn start_backend(_app: &tauri::App) -> Result<Backend, Box<dyn std::error::Error>> {
    Ok(Backend {
        url: "http://127.0.0.1:8000".to_string(),
        child: Mutex::new(None),
    })
}

/// Release: start the bundled backend on a free port, keeping its data in the
/// app's local data folder (not the roaming one: it holds gigabytes). Given this process's id, it exits by itself should the
/// app crash before it can be stopped.
#[cfg(not(debug_assertions))]
fn start_backend(app: &tauri::App) -> Result<Backend, Box<dyn std::error::Error>> {
    use tauri_plugin_shell::ShellExt;

    let data = app.path().app_local_data_dir()?;
    std::fs::create_dir_all(&data)?;
    let port = std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let port_arg = port.to_string();
    let parent_arg = std::process::id().to_string();

    let (mut output, child) = app
        .shell()
        .sidecar("backend")?
        .args(["--port", port_arg.as_str(), "--parent", parent_arg.as_str()])
        .env("XREF_DATA_DIR", data.to_string_lossy().to_string())
        .spawn()?;

    // Keep reading its output: a full pipe would stall the backend.
    tauri::async_runtime::spawn(async move {
        while output.recv().await.is_some() {}
    });

    Ok(Backend {
        url: format!("http://127.0.0.1:{port}"),
        child: Mutex::new(Some(child)),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let mut effect = "none";
            if let Some(window) = app.get_webview_window("main") {
                effect = apply_backdrop(&window);
            }
            app.manage(Backdrop(effect));
            app.manage(start_backend(app)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backdrop, backend_url])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let backend = handle.state::<Backend>();
            let mut child = backend.child.lock().unwrap();
            if let Some(process) = child.take() {
                let _ = process.kill();
            }
        }
    });
}
