fn main() {
    const COMMANDS: &[&str] = &[
        "read_dropped_file",
        "set_close_to_tray",
        "set_debug_mode",
        "splash_open_webview2_download",
        "splash_start",
        "splash_status",
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(error) = tauri_build::try_build(attributes) {
        panic!("failed to build dsh-desktop: {error:#}");
    }
}
