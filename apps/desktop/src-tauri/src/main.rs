//! dsh-desktop — a minimal Tauri 2 shell that hosts the 'dsh web' profile.
//!
//! The shell spawns a Node process running the dsh CLI ('<cli> web --port 0
//! --no-open'), waits for the readiness URL line the web profile prints once
//! its Loader tree settles, and navigates the window to that URL. The
//! `--no-open` flag suppresses the web profile's default-browser handoff: the
//! shell owns the window that shows the page, so a system browser tab would
//! duplicate it. The runtime is resolved from the environment:
//!
//! - 'DSH_NODE' — the Node executable (default: 'node' from PATH)
//! - 'DSH_CLI' — the dsh CLI entry, e.g. 'apps/cli/lib/bin.js' (required)
//!
//! Test-version scope: no bundled Node sidecar, no installer, no Linux
//! node-pty handling. See apps/desktop/README.md.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine as _;
use sysinfo::{Pid, System};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{DragDropEvent, Emitter, Manager, Url, WebviewWindow, WindowEvent};
use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WINDOW_STYLE, WS_MAXIMIZEBOX, WS_THICKFRAME};

/// Holds the spawned runtime so it can be terminated at app exit.
struct DshRuntime(Mutex<Option<Child>>);

/// Ordered splash status board the splashscreen page polls via `splash_status`.
/// The low-level `window.__TAURI_INTERNALS__` bridge is always injected, but the
/// `withGlobalTauri` high-level API is not (no @tauri-apps/api dependency), so
/// status flows Rust -> board -> poll rather than Rust -> event -> listener.
struct SplashBoard(Mutex<Vec<serde_json::Value>>);

/// Close-to-tray switch (the bridge's desktop setting, mirrored into the shell
/// by the page): when true, closing the main window hides it instead of
/// exiting; the tray menu holds the real exit.
struct CloseToTray(Mutex<bool>);

/// Paths the user dropped on the main window recently — the ONLY files the
/// page may read back through `read_dropped_file`. The page is served on plain
/// loopback with no auth, so the read surface stays user-gesture-bounded.
struct DroppedPaths(Mutex<Vec<(PathBuf, Instant)>>);

/// Canonical directories received from Explorer and not yet consumed by the
/// bridge client. The queue covers both initial launch and second-instance
/// delivery while the web page is still loading.
struct PendingOpenPaths(Mutex<Vec<PathBuf>>);

/// Holds the sampler's process view and the hysteresis state used by the
/// title-bar workload indicator. Only the normalized tier leaves this state.
struct WorkloadSampler(Mutex<WorkloadSamplerState>);

struct WorkloadSamplerState {
    system: System,
    ready: bool,
    hysteresis: WorkloadHysteresis,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorkloadTier {
    Unknown,
    Calm,
    Active,
    Busy,
    Saturated,
}

impl WorkloadTier {
    fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Calm => "calm",
            Self::Active => "active",
            Self::Busy => "busy",
            Self::Saturated => "saturated",
        }
    }
}

struct WorkloadHysteresis {
    current: WorkloadTier,
    candidate: Option<(WorkloadTier, Instant)>,
}

const WORKLOAD_MIN_DWELL: Duration = Duration::from_secs(4);

impl WorkloadHysteresis {
    fn new() -> Self {
        Self {
            current: WorkloadTier::Unknown,
            candidate: None,
        }
    }

    fn update(&mut self, pressure: f32, now: Instant) -> WorkloadTier {
        if self.current == WorkloadTier::Unknown {
            self.current = tier_for_pressure(pressure);
            return self.current;
        }
        let next = transition_target(self.current, pressure);
        if next == self.current {
            self.candidate = None;
            return self.current;
        }
        match self.candidate {
            Some((candidate, since))
                if candidate == next && now.duration_since(since) >= WORKLOAD_MIN_DWELL =>
            {
                self.current = next;
                self.candidate = None;
            }
            Some((candidate, _)) if candidate == next => {}
            _ => self.candidate = Some((next, now)),
        }
        self.current
    }
}

fn tier_for_pressure(pressure: f32) -> WorkloadTier {
    if pressure >= 85.0 {
        WorkloadTier::Saturated
    } else if pressure >= 60.0 {
        WorkloadTier::Busy
    } else if pressure >= 30.0 {
        WorkloadTier::Active
    } else {
        WorkloadTier::Calm
    }
}

/// Enter and exit thresholds are deliberately asymmetric so a boundary value
/// does not make the title-bar emoji alternate between adjacent tiers.
fn transition_target(current: WorkloadTier, pressure: f32) -> WorkloadTier {
    match current {
        WorkloadTier::Calm if pressure >= 35.0 => tier_for_pressure(pressure),
        WorkloadTier::Active if pressure < 25.0 => WorkloadTier::Calm,
        WorkloadTier::Active if pressure >= 65.0 => tier_for_pressure(pressure),
        WorkloadTier::Busy if pressure < 55.0 => tier_for_pressure(pressure),
        WorkloadTier::Busy if pressure >= 90.0 => WorkloadTier::Saturated,
        WorkloadTier::Saturated if pressure < 75.0 => tier_for_pressure(pressure),
        _ => current,
    }
}

/// How long a dropped path stays readable (the page reads it immediately
/// after the drop).
const DROP_ALLOW_SECS: u64 = 300;

/// Cap on the byte-bridge image read (`read_dropped_file`); the composer's own
/// image limits stay authoritative and reject oversized reads at intake.
const DROPPED_READ_MAX_BYTES: usize = 20 * 1024 * 1024;

/// Runtime wiring resolved at boot: where Node and the dsh CLI live, the
/// bare-module base for the closed runtime, and how the desktop bridge packages
/// reach the web profile.
///
/// Dev (DSH_CLI set) keeps the launcher's env wiring: system node, repo-built
/// CLI, bridge packages copied from the repository checkout. A packaged app
/// carries the runtime in its resources and the bundled Node as a sidecar
/// beside the exe; its bridge packages are copied from the runtime instead.
struct RuntimePaths {
    node: String,
    cli: String,
    /// Optional explicit module-resolution base for the spawned runtime. The
    /// packaged default is unset so profile-installed bundles remain visible;
    /// the profile fallback links built-in packages back to the runtime.
    module_base: Option<String>,
    /// Runtime 'node_modules/@deepseek-ai' package dirs to copy into the
    /// profile (packaged, offline); empty in dev where the repository
    /// checkout supplies the bridge packages.
    bridge_copy: Vec<PathBuf>,
}

impl RuntimePaths {
    fn from_env() -> Self {
        RuntimePaths {
            node: std::env::var("DSH_NODE").unwrap_or_else(|_| "node".to_string()),
            cli: std::env::var("DSH_CLI").unwrap_or_default(),
            module_base: std::env::var("DSH_BARE_MODULE_BASE").ok(),
            bridge_copy: Vec::new(),
        }
    }

    /// Dev mode: a DSH_CLI was set (the dev launcher points it at the
    /// repository's built CLI), so the repository checkout supplies the
    /// bridge packages.
    fn is_dev(&self) -> bool {
        !self.cli.is_empty()
    }

    fn packaged(handle: &tauri::AppHandle) -> Option<Self> {
        // `resource_dir` returns a `\\?\` verbatim path on Windows, which node's
        // realpath cannot resolve (EISDIR on the drive letter); strip it before
        // handing the path to node or converting it to a file URL.
        let resource_cli = handle
            .path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join("runtime").join("lib").join("bin.js"))
            .filter(|path| path.exists())
            .map(|path| dunce::simplified(&path).to_owned())?;
        let node = std::env::var("DSH_NODE").unwrap_or_else(|_| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|dir| dir.join("node.exe")))
                .filter(|path| path.exists())
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_else(|| "node".to_string())
        });
        let module_base = std::env::var("DSH_BARE_MODULE_BASE").ok();
        let runtime_root = resource_cli
            .parent()
            .and_then(Path::parent)
            .map(|dir| dir.to_path_buf())?;
        let bridge_copy = [
            "dsh-desktop-bridge",
            "dsh-desktop-bridge-client",
            "schemastery",
        ]
        .into_iter()
        .map(|pkg| {
            runtime_root
                .join("node_modules")
                .join("@deepseek-ai")
                .join(pkg)
        })
        .filter(|path| path.exists())
        .collect();
        Some(RuntimePaths {
            node,
            cli: resource_cli.to_string_lossy().into_owned(),
            module_base,
            bridge_copy,
        })
    }
}

/// Toggle WebView2 DevTools availability (F12 / context-menu inspect).
/// The page suppresses right-click and devtools shortcuts on its own when
/// debug mode is off; this closes the browser-level escape hatch the page
/// cannot intercept (WebView2's own F12 handling).
#[tauri::command]
fn set_debug_mode(window: WebviewWindow, enabled: bool) {
    let _ = window.with_webview(move |platform_webview| {
        let controller = platform_webview.controller();
        unsafe {
            let _ = controller
                .CoreWebView2()
                .and_then(|webview| webview.Settings())
                .and_then(|settings| settings.SetAreDevToolsEnabled(enabled));
        }
    });
}

/// How long to wait for the readiness URL line after spawning.
const BOOT_TIMEOUT: Duration = Duration::from_secs(120);

/// Mirror the bridge's close-to-tray desktop setting into the shell. The page
/// (bridge client) pushes the durable value on boot and on every settings
/// change; the main window's `CloseRequested` handler reads this flag.
#[tauri::command]
fn set_close_to_tray(app: tauri::AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<CloseToTray>() {
        *state.0.lock().unwrap() = enabled;
    }
}

/// Return the title-bar workload tier for the desktop process and its managed
/// runtime descendants. The response intentionally contains no process ids,
/// names, or raw measurements; unsupported or incomplete samples are neutral.
#[tauri::command]
fn runtime_status(app: tauri::AppHandle) -> serde_json::Value {
    let Some(sampler) = app.try_state::<WorkloadSampler>() else {
        return serde_json::json!({ "tier": "unknown" });
    };
    let Some(runtime_pid) = app
        .try_state::<DshRuntime>()
        .and_then(|state| state.0.lock().unwrap().as_ref().map(|child| child.id()))
    else {
        return serde_json::json!({ "tier": "unknown" });
    };

    let mut state = sampler.0.lock().unwrap();
    state.system.refresh_all();
    let current_pid = Pid::from_u32(std::process::id());
    let runtime_pid = Pid::from_u32(runtime_pid);
    let mut roots = vec![current_pid, runtime_pid];
    let mut process_ids = std::collections::HashSet::new();
    let mut index = 0;
    while index < roots.len() {
        let parent = roots[index];
        index += 1;
        for (pid, process) in state.system.processes() {
            if process.parent() == Some(parent) && !roots.contains(pid) {
                roots.push(*pid);
            }
        }
    }
    for pid in roots {
        if state.system.process(pid).is_some() {
            process_ids.insert(pid);
        }
    }
    if process_ids.is_empty() || state.system.cpus().is_empty() || state.system.total_memory() == 0
    {
        return serde_json::json!({ "tier": "unknown" });
    }
    let cpu = process_ids
        .iter()
        .filter_map(|pid| state.system.process(*pid))
        .map(|process| process.cpu_usage())
        .sum::<f32>()
        / state.system.cpus().len() as f32;
    let memory = process_ids
        .iter()
        .filter_map(|pid| state.system.process(*pid))
        .map(|process| process.memory() as f32)
        .sum::<f32>()
        / state.system.total_memory() as f32
        * 100.0;
    if !cpu.is_finite() || !memory.is_finite() {
        return serde_json::json!({ "tier": "unknown" });
    }
    if !state.ready {
        state.ready = true;
        return serde_json::json!({ "tier": "unknown" });
    }
    let tier = state.hysteresis.update(cpu.max(memory), Instant::now());
    serde_json::json!({ "tier": tier.as_str() })
}

/// Read back a file the user dropped on the window as base64, bounded to
/// {@const DROPPED_READ_MAX_BYTES}. Only paths from the recent drop allowlist
/// are served. The bridge client uses this to keep image drops on the
/// composer's intake path (WebView2 never sees OS drops once Tauri handles
/// them).
#[tauri::command]
fn read_dropped_file(app: tauri::AppHandle, path: String) -> Option<String> {
    let allowed = app.try_state::<DroppedPaths>().is_some_and(|state| {
        let now = Instant::now();
        let mut list = state.0.lock().unwrap();
        list.retain(|(_, at)| now.duration_since(*at).as_secs() < DROP_ALLOW_SECS);
        list.iter()
            .any(|(candidate, _)| *candidate == PathBuf::from(&path))
    });
    if !allowed {
        return None;
    }
    let data = std::fs::read(&path).ok()?;
    if data.len() > DROPPED_READ_MAX_BYTES {
        return None;
    }
    Some(base64::engine::general_purpose::STANDARD.encode(data))
}

/// Drain directories delivered by Explorer into the bridge client.
#[tauri::command]
fn take_open_paths(app: tauri::AppHandle) -> Vec<String> {
    let state = app.state::<PendingOpenPaths>();
    let mut paths = state.0.lock().unwrap();
    paths
        .drain(..)
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Add the first directory argument from one process invocation to the
/// pending queue. Canonical paths make client-side ancestor matching stable.
fn enqueue_open_path(app: &tauri::AppHandle, args: &[String]) -> bool {
    let Some(path) = args
        .iter()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| path.is_dir())
        .and_then(|path| std::fs::canonicalize(path).ok())
        .map(|path| dunce::simplified(&path).to_owned())
    else {
        return false;
    };
    app.state::<PendingOpenPaths>().0.lock().unwrap().push(path);
    true
}

/// Create the system tray icon with its menu (显示主窗口 / 退出). A left
/// click on the icon shows the main window; the menu's exit is the one real
/// quit once close-to-tray is enabled. Without a bundled window icon the tray
/// is skipped (the icon is the whole tray).
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("dsh-desktop-tray")
        .tooltip("dsh-desktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => quit_app(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Show and focus the main window (tray "show" / left click).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Real exit: stop the runtime child and terminate the app. This is the tray's
/// exit path; a plain window close may now hide instead (close-to-tray).
fn quit_app(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<DshRuntime>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    app.exit(0);
}

/// Restore the native resize borders and Windows 11 snap-layout flyout on the
/// frameless main window. tao removes `WS_CAPTION | WS_THICKFRAME` for
/// undecorated windows; re-adding `WS_THICKFRAME` (without `WS_CAPTION`) gives
/// the OS resize hit-testing and the maximize-button snap overlay while the
/// title bar stays custom. Applied after the window exists; failures leave
/// the tao default (no resize borders) rather than panicking.
#[cfg(windows)]
fn apply_windows_chrome(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        let style = WINDOW_STYLE(GetWindowLongPtrW(hwnd, GWL_STYLE) as u32);
        let updated = style | WS_THICKFRAME | WS_MAXIMIZEBOX;
        if updated != style {
            let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, updated.0 as isize);
            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            );
        }
    }
}

/// Main-window lifecycle wiring: close-to-tray interception and the dropped-
/// path allowlist feeding `read_dropped_file`.
fn wire_main_window_events(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let handle = app.clone();
    window.clone().on_window_event(move |event| match event {
        // The title bar reads maximize state from the window (never from a
        // click): every size change re-queries the window and pushes the
        // authoritative value so the icon follows snap layouts and OS
        // shortcuts, not just the injected button.
        WindowEvent::Resized(_) => {
            let maximized = window.is_maximized().unwrap_or(false);
            let _ = window.emit("dsh://maximize-change", maximized);
        }
        WindowEvent::CloseRequested { api, .. } => {
            let close_to_tray = handle.state::<CloseToTray>();
            if *close_to_tray.0.lock().unwrap() {
                api.prevent_close();
                let _ = window.hide();
            }
        }
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            let now = Instant::now();
            let dropped = handle.state::<DroppedPaths>();
            let mut list = dropped.0.lock().unwrap();
            list.retain(|(_, at)| now.duration_since(*at).as_secs() < DROP_ALLOW_SECS);
            list.extend(paths.iter().cloned().map(|path| (path, now)));
        }
        _ => {}
    });
}

/// Register the Explorer "以 dsh-desktop 打开" context-menu entries under HKCU
/// (per-user, no elevation): on a folder row (`Directory`) and on a folder's
/// empty background (`Directory\Background`). Idempotent — rewritten on every
/// start so the command always targets the current executable. The menu runs
/// `<exe> <folder>`; the single-instance plugin queues the canonical folder
/// for the bridge client. Registration failures are logged, never fatal.
/// Because the entries are written here rather than by the installer, the
/// uninstaller removes them through `installer-hooks.nsh`.
#[cfg(windows)]
fn ensure_explorer_context_menu() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let exe = exe.to_string_lossy().into_owned();
    let command = format!("\"{exe}\" \"%V\"");
    let label = "以 dsh-desktop 打开";
    for base in [
        "HKCU\\Software\\Classes\\Directory\\shell\\dsh-desktop",
        "HKCU\\Software\\Classes\\Directory\\Background\\shell\\dsh-desktop",
    ] {
        if let Err(err) = reg_add(base, &["/ve", "/d", label, "/f"]) {
            eprintln!("[dsh-desktop] context menu registration failed for {base}: {err}");
        }
        if let Err(err) = reg_add(base, &["/v", "Icon", "/d", &exe, "/f"]) {
            eprintln!("[dsh-desktop] context menu icon registration failed for {base}: {err}");
        }
        if let Err(err) = reg_add(&format!("{base}\\command"), &["/ve", "/d", &command, "/f"]) {
            eprintln!("[dsh-desktop] context menu command registration failed for {base}: {err}");
        }
    }
}

/// Run one `reg add` against `HKCU\<base>` (reg.exe is present on every
/// supported Windows).
#[cfg(windows)]
fn reg_add(base: &str, args: &[&str]) -> std::io::Result<()> {
    let status = Command::new("reg")
        .args(["add", base])
        .args(args)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other("reg add exited nonzero"))
    }
}

fn main() {
    let titlebar_version = env!("CARGO_PKG_VERSION").to_owned();
    tauri::Builder::default()
        .on_page_load(move |webview, payload| {
            if webview.label() != "main" || payload.event() != PageLoadEvent::Finished {
                return;
            }
            let script = titlebar_script(&titlebar_version);
            match webview.eval(&script) {
                Ok(()) => println!("[dsh-desktop] title bar injected after page load"),
                Err(err) => eprintln!("[dsh-desktop] title bar injection failed: {err}"),
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if enqueue_open_path(app, &args) {
                show_main_window(app);
                let _ = app.emit("dsh://open-path", ());
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DshRuntime(Mutex::new(None)))
        .manage(SplashBoard(Mutex::new(Vec::new())))
        .manage(CloseToTray(Mutex::new(false)))
        .manage(WorkloadSampler(Mutex::new(WorkloadSamplerState {
            system: System::new(),
            ready: false,
            hysteresis: WorkloadHysteresis::new(),
        })))
        .manage(DroppedPaths(Mutex::new(Vec::new())))
        .manage(PendingOpenPaths(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            set_debug_mode,
            set_close_to_tray,
            runtime_status,
            read_dropped_file,
            take_open_paths,
            splash_start,
            splash_status,
            splash_open_webview2_download
        ])
        .setup(|app| {
            splash_log(&format!(
                "setup: main window found = {}",
                app.get_webview_window("main").is_some()
            ));
            setup_tray(app.handle())?;
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                apply_windows_chrome(&window);
            }
            wire_main_window_events(app.handle());
            let args = std::env::args().collect::<Vec<_>>();
            enqueue_open_path(app.handle(), &args);
            #[cfg(windows)]
            ensure_explorer_context_menu();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the tauri app")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<DshRuntime>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}

/// Ensure the bridge packages are present in the web profile and return the
/// patch overlays to mount. `DSH_PATCH` lists patch files (semicolon-
/// separated). Dev mode copies the bridge packages from the repository
/// checkout on every boot (a rebuilt bridge must always reach the profile);
/// a packaged runtime copies its own bridge packages. No npm anywhere — the
/// npm install path dies on the published @deepseek-ai manifests' workspace:
/// protocol.
fn ensure_bridge(node: &str, cli: &str, paths: &RuntimePaths) -> Vec<String> {
    let patches: Vec<String> = std::env::var("DSH_PATCH")
        .into_iter()
        .flat_map(|v| {
            v.split(';')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
        })
        .collect();
    if !paths.is_dev() && paths.bridge_copy.is_empty() {
        return patches;
    }
    let home = std::env::var("DSH_HOME").unwrap_or_else(|_| {
        let base = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        format!("{base}/.dsh")
    });
    let profile = std::path::Path::new(&home).join("profiles").join("web");
    let marker = profile
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh-desktop-bridge");
    if marker.join("package.json").exists() && !paths.is_dev() {
        // Packaged mode keeps the profile's bridge in lockstep with the
        // runtime's on every boot: the bridge lib is a build artifact that
        // source changes refresh, so a one-time copy would leave the profile
        // on stale behavior after an upgrade (missing routes, dead plugin).
        // Dev mode copies on every boot below for the same reason.
        copy_bridge_packages(&profile, &paths.bridge_copy);
        return patches;
    }
    if !profile.exists() {
        // First boot: let the CLI initialize the web profile template.
        let _ = Command::new(node)
            .arg(cli)
            .arg("--profile")
            .arg("web")
            .arg("--dump-default-config")
            .status();
    }
    if !profile.exists() {
        eprintln!(
            "[dsh-desktop] profile {} missing after init; continuing without the bridge",
            profile.display()
        );
        return patches;
    }
    let sources = if paths.is_dev() {
        bridge_sources_from_repo(cli)
    } else {
        paths.bridge_copy.clone()
    };
    let installed = !sources.is_empty() && copy_bridge_packages(&profile, &sources);
    if installed {
        eprintln!("[dsh-desktop] bridge installed into {}", profile.display());
        install_profile_patch(&profile);
    }
    patches
}

/// Dev-mode bridge sources: the bridge packages plus their prod dependency
/// (schemastery), resolved from the repository checkout the dev CLI runs from
/// (<repo>/apps/cli/lib/bin.js). Entries missing from a partial checkout are
/// dropped; an empty result fails the install below.
fn bridge_sources_from_repo(cli: &str) -> Vec<PathBuf> {
    let Some(repo) = Path::new(cli)
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .and_then(Path::parent)
    else {
        return Vec::new();
    };
    let schemastery = repo
        .join("node_modules")
        .join("@deepseek-ai")
        .join("schemastery");
    let schemastery = std::fs::canonicalize(&schemastery).unwrap_or(schemastery);
    [
        repo.join("apps").join("desktop").join("bridge"),
        repo.join("apps").join("desktop").join("bridge-client"),
        schemastery,
    ]
    .into_iter()
    .filter(|path| path.join("package.json").exists())
    .collect()
}

/// Copy the packaged bridge packages into the profile's node_modules (closed
/// runtime, offline). A recursive copy replaces npm's install: the bridge
/// packages plus their prod dependency (schemastery) travel from the runtime.
fn copy_bridge_packages(profile: &Path, sources: &[PathBuf]) -> bool {
    let mut ok = true;
    for source in sources {
        let Ok(name) = package_directory(source) else {
            eprintln!(
                "[dsh-desktop] failed to resolve package name from {}",
                source.display()
            );
            ok = false;
            continue;
        };
        let target = profile.join("node_modules").join("@deepseek-ai").join(name);
        if copy_dir_recursive(source, &target).is_err() {
            eprintln!(
                "[dsh-desktop] failed to copy bridge package {} into {}",
                source.display(),
                profile.display()
            );
            ok = false;
        }
    }
    ok
}

/// Resolve the directory below `node_modules/@deepseek-ai` from a package's
/// manifest name. Repository source directories do not necessarily match the
/// published package name (`bridge-client` vs. `dsh-desktop-bridge-client`).
fn package_directory(source: &Path) -> std::io::Result<String> {
    let manifest = std::fs::read_to_string(source.join("package.json"))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;
    let name = manifest["name"]
        .as_str()
        .and_then(|name| name.strip_prefix("@deepseek-ai/"))
        .filter(|name| !name.is_empty() && !name.contains(['/', '\\']))
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "package name must belong to @deepseek-ai",
            )
        })?;
    Ok(name.to_string())
}
/// Recursively copy a directory, replacing an existing target.
fn copy_dir_recursive(source: &Path, target: &Path) -> std::io::Result<()> {
    if target.exists() {
        std::fs::remove_dir_all(target)?;
    }
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let destination = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &destination)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}

/// Append the bridge rows (installed bridge package's cordis.patch.yml) to
/// the profile's user patch layer, idempotently. Rows must live in the user
/// layer: a `--patch` overlay applies after it, so profile patches could not
/// configure bridge rows inserted there.
fn install_profile_patch(profile: &std::path::Path) {
    let bridge_patch = profile
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh-desktop-bridge")
        .join("cordis.patch.yml");
    let profile_patch = profile.join("cordis.patch.yml");
    let Ok(source) = std::fs::read_to_string(&bridge_patch) else {
        eprintln!("[dsh-desktop] bridge patch file missing; skipping profile patch install");
        return;
    };
    let existing = std::fs::read_to_string(&profile_patch).unwrap_or_default();
    if existing.contains("id: desktop-bridge") {
        return;
    }
    // The profile template ships a comment header plus an empty `[]` list.
    // Replace that empty list with the bridge rows so they join the existing
    // array; appending after it would emit a second YAML document and break
    // the profile parse.
    let merged = if existing.contains("[]") {
        existing.replacen("[]", &source, 1)
    } else {
        let mut merged = existing;
        if !merged.is_empty() && !merged.ends_with('\n') {
            merged.push('\n');
        }
        merged.push_str(&source);
        merged
    };
    if std::fs::write(&profile_patch, merged).is_ok() {
        eprintln!(
            "[dsh-desktop] bridge rows appended to {}; edit the desktop-bridge config there",
            profile_patch.display()
        );
    } else {
        eprintln!(
            "[dsh-desktop] failed to append bridge rows to {}",
            profile_patch.display()
        );
    }
}

/// Append a diagnostic line to the splash log file. A Windows GUI-subsystem app
/// has no console, so stderr is invisible; the file is the diagnostic channel.
fn splash_log(message: &str) {
    let path = std::env::temp_dir().join("dsh-desktop-splash.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{message}");
    }
}

/// Record a splash status entry on the polled board; the latest write for a
/// step wins, and the splashscreen page renders the board on each poll.
fn push_status(
    handle: &tauri::AppHandle,
    step: &str,
    status: &str,
    message: &str,
    suggestion: Option<&str>,
) {
    splash_log(&format!("push_status: {step} = {status}"));
    let entry = serde_json::json!({ "step": step, "status": status, "message": message, "suggestion": suggestion });
    if let Some(board) = handle.try_state::<SplashBoard>() {
        let mut list = board.0.lock().unwrap();
        if let Some(existing) = list.iter_mut().find(|e| e["step"].as_str() == Some(step)) {
            *existing = entry;
        } else {
            list.push(entry);
        }
    }
}

/// Resolve the runtime wiring: env wins (dev launcher), a packaged app falls
/// back to its own resources. Without either, the dev launcher hint surfaces.
fn resolve_paths(handle: &tauri::AppHandle) -> RuntimePaths {
    splash_log(&format!(
        "resolve_paths: DSH_CLI set={}, resource_dir={:?}",
        std::env::var("DSH_CLI").is_ok(),
        handle.path().resource_dir().ok()
    ));
    if std::env::var("DSH_CLI").is_ok() {
        RuntimePaths::from_env()
    } else if let Some(paths) = RuntimePaths::packaged(handle) {
        println!("[dsh-desktop] packaged runtime at {}", paths.cli);
        paths
    } else {
        RuntimePaths::from_env()
    }
}

/// The home directory the runtime persists into (mirrors `ensure_bridge`).
fn dsh_home() -> String {
    std::env::var("DSH_HOME").unwrap_or_else(|_| {
        let base = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        format!("{base}/.dsh")
    })
}

/// Run the pre-boot environment checks, emitting a status for each. Returns
/// false when a fatal check failed (the splash stays up and offers a retry);
/// warn-only problems (a missing API key) do not block.
fn run_checks(handle: &tauri::AppHandle, paths: &RuntimePaths) -> bool {
    let mut fatal = false;

    // WebView2: rendering the splash already proves the runtime is present and
    // functional. Version/repair guidance lands in a later milestone.
    push_status(handle, "webview2", "ok", "WebView2 可用", None);

    // Node executable: a full path must exist; a bare command name is left for
    // the spawn below to surface.
    let node_is_path = paths.node.contains('/') || paths.node.contains('\\');
    if node_is_path && !Path::new(&paths.node).is_file() {
        push_status(handle, "node", "error", "未找到 Node 运行时", None);
        fatal = true;
    } else {
        push_status(handle, "node", "ok", paths.node.as_str(), None);
    }

    // dsh CLI entry.
    if paths.cli.is_empty() || !Path::new(&paths.cli).is_file() {
        push_status(
            handle,
            "runtime",
            "error",
            "dsh 运行时缺失",
            Some("请重新安装 dsh-desktop"),
        );
        fatal = true;
    } else {
        push_status(handle, "runtime", "ok", "dsh 运行时就绪", None);
    }

    // Data directory: create it if missing; a failure to create it is fatal.
    let home = dsh_home();
    if std::fs::create_dir_all(&home).is_ok() {
        push_status(handle, "home", "ok", "数据目录可写", None);
    } else {
        push_status(
            handle,
            "home",
            "error",
            "无法创建数据目录",
            Some(format!("请检查 {home} 的权限").as_str()),
        );
        fatal = true;
    }

    // API key: warn only — the user can configure it in the app.
    if std::env::var("DEEPSEEK_API_KEY").is_ok() {
        push_status(handle, "api-key", "ok", "已配置 API Key", None);
    } else {
        push_status(
            handle,
            "api-key",
            "warn",
            "未配置 DEEPSEEK_API_KEY（可稍后在设置中配置）",
            None,
        );
    }

    !fatal
}

/// Run the splash flow: checks first, then bridge + boot. The splash closes and
/// the main window appears once the `dsh web:` readiness line arrives.
fn run_splash_flow(window: WebviewWindow, handle: tauri::AppHandle) {
    splash_log("run_splash_flow: begin");
    let paths = resolve_paths(&handle);
    splash_log(&format!(
        "run_splash_flow: cli={} node={}",
        paths.cli, paths.node
    ));
    if !run_checks(&handle, &paths) {
        splash_log("run_splash_flow: checks failed, staying on splash");
        return;
    }
    boot(window, handle, paths);
}

/// Return the current splash status board for the splashscreen page to render.
#[tauri::command]
fn splash_status(app: tauri::AppHandle) -> Vec<serde_json::Value> {
    app.state::<SplashBoard>().0.lock().unwrap().clone()
}

/// Start the splash flow: run environment checks, then bridge + boot. Called by
/// the splashscreen page on load and again by its retry button; a fresh start
/// clears the board so stale entries never linger.
#[tauri::command]
fn splash_start(app: tauri::AppHandle) {
    splash_log("splash_start: invoked");
    app.state::<SplashBoard>().0.lock().unwrap().clear();
    std::thread::spawn(move || {
        // The main window's webview can lag the splash page's first command
        // round-trip; retry briefly before giving up.
        let window = (0..60).find_map(|i| {
            if i > 0 {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            app.get_webview_window("main")
        });
        match window {
            Some(window) => {
                splash_log("splash_start: main window found");
                run_splash_flow(window, app);
            }
            None => {
                splash_log("splash_start: main window NOT found after retries");
                push_status(&app, "runtime", "error", "主窗口未找到", None);
            }
        }
    });
}

/// Open the WebView2 Evergreen download page in the system browser. The splash
/// itself is a WebView2 page, so it cannot install a missing WebView2 runtime;
/// this routes the user to Microsoft's download for the repair/version case.
#[tauri::command]
fn splash_open_webview2_download(app: tauri::AppHandle) {
    let url = "https://developer.microsoft.com/microsoft-edge/webview2/";
    if let Err(err) = app.opener().open_url(url, None::<&str>) {
        eprintln!("[dsh-desktop] failed to open WebView2 download page: {err}");
    }
}

/// The web-profile arguments the shell hands the spawned CLI: boot the web
/// profile, apply the bridge patches, bind an OS-assigned port, and suppress
/// the default-browser handoff — the shell navigates its own window to the
/// served page.
fn web_profile_args(patches: &[String]) -> Vec<String> {
    let mut args = vec!["web".to_owned()];
    for patch in patches {
        args.push("--patch".to_owned());
        args.push(patch.clone());
    }
    args.push("--port".to_owned());
    args.push("0".to_owned());
    args.push("--no-open".to_owned());
    args
}

/// Spawn the dsh runtime, wait for readiness, and navigate the window.
fn boot(window: WebviewWindow, handle: tauri::AppHandle, paths: RuntimePaths) {
    if paths.cli.is_empty() {
        fail(
            &handle,
            "DSH_CLI is not set; point it at the dsh CLI entry (apps/cli/lib/bin.js). Run `node apps/desktop/scripts/dev.mjs`.",
        );
        return;
    }

    push_status(&handle, "bridge", "running", "准备桥接包", None);
    let patches = ensure_bridge(&paths.node, &paths.cli, &paths);
    push_status(&handle, "bridge", "ok", "桥接包就绪", None);

    push_status(&handle, "boot", "running", "启动 dsh 服务", None);
    let args = web_profile_args(&patches);
    splash_log(&format!(
        "boot: spawning `{} {} {}` module_base={:?}",
        paths.node,
        paths.cli,
        args.join(" "),
        paths.module_base
    ));
    let mut cmd = Command::new(&paths.node);
    cmd.arg(&paths.cli).args(&args);
    if let Some(module_base) = &paths.module_base {
        cmd.env("DSH_BARE_MODULE_BASE", module_base);
    }
    // The runtime is a console-subsystem binary (node.exe); a GUI-subsystem
    // parent would otherwise give it a visible console window. CREATE_NO_WINDOW
    // keeps the spawn headless, and null stdin stops node from attaching to the
    // absent console.
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            fail(
                &handle,
                &format!(
                    "failed to spawn `{} {} {}`: {err}",
                    paths.node,
                    paths.cli,
                    args.join(" ")
                ),
            );
            return;
        }
    };

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    if let Some(state) = handle.try_state::<DshRuntime>() {
        *state.0.lock().unwrap() = Some(child);
    }

    // Forward the runtime's stderr to the log (and console in dev).
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => {
                    splash_log(&format!("[dsh stderr] {line}"));
                    eprintln!("[dsh] {line}");
                }
                Err(_) => break,
            }
        }
    });

    // Collect stdout lines; forward non-readiness lines to the log.
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    splash_log(&format!("[dsh stdout] {line}"));
                    if tx.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let deadline = Instant::now() + BOOT_TIMEOUT;
    loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(line) => {
                if let Some(rest) = line.strip_prefix("dsh web: ") {
                    if let Some(candidate) = rest.split_whitespace().next() {
                        match Url::parse(candidate) {
                            Ok(url) => {
                                println!("[dsh-desktop] ready at {url}");
                                push_status(&handle, "boot", "ok", "dsh 服务就绪", None);
                                if let Some(splash) = handle.get_webview_window("splashscreen") {
                                    let _ = splash.close();
                                }
                                if let Err(err) = window.show() {
                                    fail(
                                        &handle,
                                        &format!("failed to show the main window: {err}"),
                                    );
                                    return;
                                }
                                if window.navigate(url).is_err() {
                                    fail(&handle, "window is gone; cannot navigate");
                                    return;
                                }
                                return;
                            }
                            Err(err) => {
                                eprintln!("[dsh-desktop] unparsable URL line `{candidate}`: {err}");
                            }
                        }
                    }
                } else {
                    println!("[dsh] {line}");
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if Instant::now() > deadline {
                    fail(
                        &handle,
                        "dsh runtime did not become ready within 120s (no `dsh web:` readiness line)",
                    );
                    return;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                fail(
                    &handle,
                    "dsh runtime exited before printing its readiness line",
                );
                return;
            }
        }
    }
}

/// Build the shared title bar script (apps/desktop/src/titlebar.js) for a
/// completed main-window page load. The version global is prepended rather
/// than baked into the file so the loading page (a plain `<script
/// src="titlebar.js">`, no global) keeps rendering the bare title.
fn titlebar_script(version: &str) -> String {
    format!(
        "window.__DSH_DESKTOP_VERSION__ = {};{}",
        js_string(version),
        include_str!("../../src/titlebar.js"),
    )
}

/// Report a boot failure: emit it to the splash checklist and, for failures
/// after the main window is shown, also surface it on the loading page.
fn fail(handle: &tauri::AppHandle, message: &str) {
    eprintln!("[dsh-desktop] boot failure: {message}");
    push_status(handle, "boot", "error", message, None);
    if let Some(window) = handle.get_webview_window("main") {
        let js = format!("window.__dshBootError({})", js_string(message));
        for _ in 0..40 {
            if window.eval(&js).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
}

/// Quote a string as a JavaScript string literal.
fn js_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workload_tiers_have_stable_thresholds() {
        assert_eq!(tier_for_pressure(0.0), WorkloadTier::Calm);
        assert_eq!(tier_for_pressure(30.0), WorkloadTier::Active);
        assert_eq!(tier_for_pressure(60.0), WorkloadTier::Busy);
        assert_eq!(tier_for_pressure(85.0), WorkloadTier::Saturated);
    }

    #[test]
    fn web_profile_args_suppress_the_default_browser_handoff() {
        let args = web_profile_args(&["one.yml".to_owned(), "two.yml".to_owned()]);
        assert_eq!(
            args,
            [
                "web",
                "--patch",
                "one.yml",
                "--patch",
                "two.yml",
                "--port",
                "0",
                "--no-open",
            ],
        );
    }

    #[test]
    fn workload_hysteresis_requires_dwell_before_transition() {
        let start = Instant::now();
        let mut state = WorkloadHysteresis::new();
        assert_eq!(state.update(10.0, start), WorkloadTier::Calm);
        assert_eq!(
            state.update(40.0, start + Duration::from_secs(1)),
            WorkloadTier::Calm
        );
        assert_eq!(
            state.update(40.0, start + Duration::from_secs(5)),
            WorkloadTier::Active
        );
        assert_eq!(
            state.update(20.0, start + Duration::from_secs(5)),
            WorkloadTier::Active
        );
        assert_eq!(
            state.update(20.0, start + Duration::from_secs(9)),
            WorkloadTier::Calm
        );
    }
}
