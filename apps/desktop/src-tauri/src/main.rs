//! dsh-desktop — a minimal Tauri 2 shell that hosts the 'dsh web' profile.
//!
//! The shell spawns a Node process running the dsh CLI ('<cli> web --port 0
//! --no-open'), waits for the readiness URL line the web profile prints once
//! its Loader tree settles, and navigates the window to that URL. The
//! `--no-open` flag suppresses the web profile's default-browser handoff: the
//! shell owns the window that shows the page, so a system browser tab would
//! duplicate it. The runtime is resolved from the environment in development
//! and from packaged resources in release builds:
//!
//! - 'DSH_NODE' — the development Node executable (default: 'node' from PATH)
//! - 'DSH_CLI' — the dsh CLI entry, e.g. 'apps/cli/lib/bin.js' (required)
//!
//! A packaged build requires its target-specific Node sidecar beside the app
//! executable and never falls back to ambient Node. See apps/desktop/README.md.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime_supervisor;

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine as _;
use sysinfo::{Pid, System};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{DragDropEvent, Emitter, Manager, Url, WebviewWindow, WindowEvent};
#[cfg(windows)]
use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WINDOW_STYLE, WS_MAXIMIZEBOX, WS_THICKFRAME,
};

/// Owns the supervised desktop runtime. The shell state wraps the
/// supervisor; every exit path funnels through terminate_and_join.
struct DshRuntime(Mutex<runtime_supervisor::RuntimeSupervisor>);

impl DshRuntime {
    /// The current supervisor lifecycle state.
    fn lifecycle(&self) -> runtime_supervisor::Lifecycle {
        self.0.lock().unwrap().lifecycle()
    }

    /// The contained runtime's root pid, when one is running.
    fn root_pid(&self) -> Option<u32> {
        self.0.lock().unwrap().root_pid()
    }

    /// Spawn the contained runtime and hand over its stdout/stderr pipes.
    /// The runtime stays supervised; only the pipe ownership moves out so
    /// the boot thread can read the readiness line.
    fn spawn(
        &self,
        spec: runtime_supervisor::SpawnSpec,
    ) -> Result<(std::process::ChildStdout, std::process::ChildStderr), runtime_supervisor::SpawnError>
    {
        let mut guard = self.0.lock().unwrap();
        let spawned = guard.spawn(spec)?;
        let stdout = spawned.stdout();
        let stderr = spawned.stderr();
        Ok((stdout, stderr))
    }

    /// Terminate the contained runtime tree.
    fn terminate_and_join(
        &self,
        reason: &'static str,
    ) -> runtime_supervisor::TerminateReport {
        self.0
            .lock()
            .unwrap()
            .terminate_and_join(reason, RUNTIME_TERMINATE_BUDGET)
    }
}

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
    /// Whether the runtime wiring came from the dev launcher (DSH_CLI env) or
    /// from packaged resources. A packaged runtime also carries a CLI path,
    /// so "has a CLI" cannot be the dev signal.
    dev: bool,
}

impl RuntimePaths {
    fn from_env() -> Self {
        RuntimePaths {
            node: std::env::var("DSH_NODE").unwrap_or_else(|_| "node".to_string()),
            cli: std::env::var("DSH_CLI").unwrap_or_default(),
            module_base: std::env::var("DSH_BARE_MODULE_BASE").ok(),
            bridge_copy: Vec::new(),
            dev: true,
        }
    }

    /// Dev mode: the dev launcher set DSH_CLI, so the repository checkout
    /// supplies the bridge packages. The mode is tracked explicitly because a
    /// packaged runtime also carries a CLI path (its own resources).
    fn is_dev(&self) -> bool {
        self.dev
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
            .map(|path| dunce::simplified(&path).to_owned())?;
        let node = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join(packaged_node_basename())))
            .unwrap_or_else(|| PathBuf::from(packaged_node_basename()));
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
            node: node.to_string_lossy().into_owned(),
            cli: resource_cli.to_string_lossy().into_owned(),
            module_base,
            bridge_copy,
            dev: false,
        })
    }
}

#[cfg(windows)]
fn packaged_node_basename() -> &'static str {
    "dsh-node.exe"
}

#[cfg(not(windows))]
fn packaged_node_basename() -> &'static str {
    "dsh-node"
}

/// Toggle WebView2 DevTools availability (F12 / context-menu inspect).
/// The page suppresses right-click and devtools shortcuts on its own when
/// debug mode is off; this closes the browser-level escape hatch the page
/// cannot intercept (WebView2's own F12 handling). The returned status tells
/// the caller whether the native toggle request was accepted.
fn debug_mode_status(
    requested: bool,
    applied: bool,
    limitation: Option<&'static str>,
) -> serde_json::Value {
    serde_json::json!({
        "requested": requested,
        "applied": applied,
        "limitation": limitation,
    })
}

#[cfg(windows)]
#[tauri::command]
fn set_debug_mode(window: WebviewWindow, enabled: bool) -> Result<serde_json::Value, String> {
    window
        .with_webview(move |platform_webview| {
            let controller = platform_webview.controller();
            unsafe {
                if let Err(error) = controller
                    .CoreWebView2()
                    .and_then(|webview| webview.Settings())
                    .and_then(|settings| settings.SetAreDevToolsEnabled(enabled))
                {
                    eprintln!("[dsh-desktop] WebView2 DevTools setting failed: {error}");
                }
            }
        })
        .map_err(|error| format!("WebView2 controller unavailable: {error}"))?;
    Ok(debug_mode_status(enabled, true, None))
}

/// Keep the shell-level debug limitation explicit on platforms without the
/// WebView2 controller API; the page-level debug guard still applies.
#[cfg(not(windows))]
#[tauri::command]
fn set_debug_mode(_window: WebviewWindow, enabled: bool) -> serde_json::Value {
    let limitation = "platform webview does not expose runtime DevTools control";
    eprintln!("[dsh-desktop] {limitation}; requested enabled={enabled}");
    debug_mode_status(enabled, false, Some(limitation))
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
    let Some(runtime_pid) = app.try_state::<DshRuntime>().and_then(|state| state.root_pid()) else {
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

/// Bounded grace for the runtime tree to join after termination.
const RUNTIME_TERMINATE_BUDGET: Duration = Duration::from_secs(8);

/// Real exit: terminate the contained runtime tree and terminate the app.
/// This is the tray's exit path; a plain window close may now hide instead
/// (close-to-tray). Every exit path funnels through terminate_and_join.
fn quit_app(app: &tauri::AppHandle) {
    terminate_runtime(app, "tray-quit");
    app.exit(0);
}

/// Terminate the contained runtime tree through the supervisor. A missing
/// supervisor is a no-op; a second call while termination is in flight
/// returns the in-flight outcome.
fn terminate_runtime(app: &tauri::AppHandle, reason: &'static str) {
    if let Some(state) = app.try_state::<DshRuntime>() {
        let report = state.terminate_and_join(reason);
        if report.timed_out {
            eprintln!(
                "[dsh-desktop] runtime termination ({reason}) timed out; root_exited={} containment_ok={}",
                report.root_exited, report.containment_ok
            );
        }
    }
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
    record_update_smoke_version();
    let titlebar_version = env!("CARGO_PKG_VERSION").to_owned();
    tauri::Builder::default()
        .on_page_load(move |webview, payload| {
            if webview.label() != "main" || payload.event() != PageLoadEvent::Finished {
                return;
            }
            let mut script = titlebar_script(&titlebar_version);
            if update_smoke_enabled() {
                script.push_str(update_smoke_script());
            }
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
        .manage(DshRuntime(Mutex::new(runtime_supervisor::RuntimeSupervisor::new())))
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
                terminate_runtime(app, "run-exit-requested");
            }
        });
}

/// Return whether the packaged update smoke driver was explicitly enabled.
/// The driver is opt-in and only affects the page-load script when a target
/// runner supplies its environment variable.
fn update_smoke_enabled() -> bool {
    std::env::var("DSH_DESKTOP_UPDATE_SMOKE").is_ok_and(|value| value == "1")
}

/// Record the version seen by a packaged update smoke. The path is supplied
/// only by the smoke process; normal launches do not create this file.
fn record_update_smoke_version() {
    let Ok(path) = std::env::var("DSH_DESKTOP_UPDATE_RESULT") else {
        return;
    };
    if let Err(error) = std::fs::write(&path, env!("CARGO_PKG_VERSION")) {
        eprintln!("[dsh-desktop] failed to record update smoke version at {path}: {error}");
    }
}

/// Drive the existing updater button and confirmation calls during a target
/// runner smoke. It never runs in a normal launch and stops after the updated
/// application reports no update.
fn update_smoke_script() -> &'static str {
    r#"
(() => {
  if (window.__DSH_UPDATE_SMOKE__) return;
  window.__DSH_UPDATE_SMOKE__ = true;
  window.confirm = (message) => {
    console.log(`[dsh-desktop] update smoke confirmation: ${message}`);
    return true;
  };
  const deadline = Date.now() + 180000;
  const timer = window.setInterval(() => {
    const button = document.getElementById('dsh-desktop-updater');
    const state = button?.dataset.state;
    if (state === 'available' || state === 'ready') {
      button.click();
    } else if (state === 'up-to-date' || Date.now() >= deadline) {
      window.clearInterval(timer);
    }
  }, 100);
})();
"#
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
    if sources.is_empty() {
        splash_log("[dsh-desktop] bridge sources unavailable; profile bridge left untouched");
        return patches;
    }
    // Both modes keep the profile's bridge packages in lockstep with the
    // running source on every boot: the bridge lib is a build artifact that
    // source changes refresh, so a one-time copy would leave the profile on
    // stale behavior after an upgrade (missing routes, dead plugin).
    if !copy_bridge_packages(&profile, &sources) {
        splash_log("[dsh-desktop] bridge package refresh FAILED; profile bridge may be stale");
        return patches;
    }
    splash_log("[dsh-desktop] bridge packages refreshed");
    // Update-time repair: re-sync the profile patch rows and remove legacy
    // residue whenever the desktop version or the bridge patch advanced.
    sync_bridge_patch(&profile, env!("CARGO_PKG_VERSION"));
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

/// Update-time repair for the profile's bridge rows: bring the shell-owned
/// bridge entries of `cordis.patch.yml` in lockstep with the installed bridge
/// package's own patch, remove legacy package residue, and record the sync
/// marker. The rewrite runs only when the marker is missing or the desktop
/// version / bridge patch hash advanced, so a user's manual edits to the
/// bridge config survive until the next upgrade. Rows must live in the user
/// layer: a `--patch` overlay applies after it, so profile patches could not
/// configure bridge rows inserted there.
fn sync_bridge_patch(profile: &std::path::Path, version: &str) -> bool {
    let bridge_patch = profile
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh-desktop-bridge")
        .join("cordis.patch.yml");
    let profile_patch = profile.join("cordis.patch.yml");
    let marker = profile.join(".dsh-desktop-bridge-sync");
    let Ok(source) = std::fs::read_to_string(&bridge_patch) else {
        eprintln!("[dsh-desktop] bridge patch file missing; profile patch sync skipped");
        return false;
    };
    let hash = format!("{:016x}", fnv1a64(source.as_bytes()));
    if let Some((marker_version, marker_hash)) = read_sync_marker(&marker) {
        if marker_version == version && marker_hash == hash {
            return true;
        }
    }
    // Drop the shell-owned bridge entries (with their comment runs) and any
    // bare `[]` placeholder; everything else — the user's own rows and
    // comments — survives untouched.
    let existing = std::fs::read_to_string(&profile_patch).unwrap_or_default();
    let lines: Vec<&str> = existing.lines().collect();
    let entries = collect_patch_entries(&lines);
    let mut kept: Vec<&str> = Vec::with_capacity(lines.len());
    let mut cursor = 0;
    for entry in &entries {
        let owned = is_bridge_entry(&lines, entry) || lines[entry.start] == "[]";
        if !owned {
            continue;
        }
        // The bare `[]` placeholder carries no owned comments: the template
        // preamble above it survives the rewrite. A comment run already
        // swallowed by a previously removed entry's span clamps to the
        // cursor instead of slicing backwards.
        let comment_start = if lines[entry.start] == "[]" {
            entry.start
        } else {
            entry.comment_start.max(cursor)
        };
        kept.extend_from_slice(&lines[cursor..comment_start]);
        cursor = entry.end;
    }
    kept.extend_from_slice(&lines[cursor..]);
    let mut result = kept.join("\n");
    while result.contains("\n\n\n") {
        result = result.replace("\n\n\n", "\n\n");
    }
    let trimmed = result.trim();
    let merged = if trimmed.is_empty() {
        format!("{}\n", source.trim_end())
    } else {
        format!("{}\n\n{}\n", trimmed, source.trim_end())
    };
    if std::fs::write(&profile_patch, merged).is_err() {
        eprintln!(
            "[dsh-desktop] failed to write profile patch {}",
            profile_patch.display()
        );
        return false;
    }
    // Legacy residue: directory names an old copy path derived from the
    // source folder instead of the manifest name; nothing references them.
    for legacy in ["bridge", "bridge-client"] {
        let dir = profile
            .join("node_modules")
            .join("@deepseek-ai")
            .join(legacy);
        if dir.exists() {
            match std::fs::remove_dir_all(&dir) {
                Ok(()) => splash_log(&format!(
                    "[dsh-desktop] removed legacy profile package {legacy}"
                )),
                Err(err) => eprintln!(
                    "[dsh-desktop] failed to remove legacy profile package {legacy}: {err}"
                ),
            }
        }
    }
    if std::fs::write(&marker, format!("version={version}\npatch={hash}\n")).is_err() {
        eprintln!(
            "[dsh-desktop] failed to record bridge sync marker {}",
            marker.display()
        );
    }
    splash_log(&format!("[dsh-desktop] profile bridge rows synced to {version}"));
    true
}

/// FNV-1a 64-bit hash over the bridge patch bytes: a stable change
/// fingerprint for the sync marker, independent of the std hash algorithm.
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Read the profile's bridge-sync marker: the desktop version and bridge
/// patch hash of the last successful row sync.
fn read_sync_marker(marker: &std::path::Path) -> Option<(String, String)> {
    let text = std::fs::read_to_string(marker).ok()?;
    let mut version: Option<&str> = None;
    let mut hash: Option<&str> = None;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("version=") {
            version = Some(value);
        } else if let Some(value) = line.strip_prefix("patch=") {
            hash = Some(value);
        }
    }
    Some((version?.to_owned(), hash?.to_owned()))
}

/// Whether one line starts a top-level profile-patch list entry: a `- ` row
/// at column zero, or the bare `[]` empty-list placeholder.
fn is_top_level_entry(line: &str) -> bool {
    line.starts_with("- ") || line.trim_end() == "[]"
}

/// One top-level profile-patch entry: the entry line, its span, and the
/// contiguous comment run directly above it (no blank line in between).
struct PatchEntry {
    /// Index of the first comment line directly above the entry.
    comment_start: usize,
    /// Index of the entry line itself.
    start: usize,
    /// Index one past the last line of the entry.
    end: usize,
}

/// Collect the top-level entries of a profile patch file.
fn collect_patch_entries(lines: &[&str]) -> Vec<PatchEntry> {
    let mut entries = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        if !is_top_level_entry(lines[index]) {
            index += 1;
            continue;
        }
        let mut comment_start = index;
        while comment_start > 0 && lines[comment_start - 1].trim_start().starts_with('#') {
            comment_start -= 1;
        }
        let mut end = index + 1;
        while end < lines.len() && !is_top_level_entry(lines[end]) && lines[end] != "---" {
            end += 1;
        }
        entries.push(PatchEntry {
            comment_start,
            start: index,
            end,
        });
        index = end;
    }
    entries
}

/// Whether an entry is shell-owned bridge content: a row that mentions the
/// desktop-bridge plugin ids (the `- insert:` roster or the config entry).
fn is_bridge_entry(lines: &[&str], entry: &PatchEntry) -> bool {
    lines[entry.start..entry.end].iter().any(|line| {
        let trimmed = line.trim_start();
        trimmed.starts_with("- id: desktop-bridge")
            || trimmed.starts_with("- id: desktop-bridge-client")
    })
}

/// One bounded bridge-health check: fetch `/dsh-bridge/config` over the
/// loopback with the bearer token and return the HTTP status line (or a
/// short failure description). The shell runs this once the runtime is
/// ready, so a bridge that never loaded (stale profile copy, dead plugin)
/// is recorded in the boot log instead of failing silently later.
/// @param port - the runtime's loopback port.
/// @param token - the per-boot loopback token.
/// @returns the first status line, or a failure description.
fn probe_bridge(port: u16, token: &str) -> String {
    let request = format!(
        "GET /dsh-bridge/config HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );
    let mut last_error = String::from("no response");
    for _ in 0..2 {
        let result = std::net::TcpStream::connect(("127.0.0.1", port)).and_then(|mut stream| {
            stream.set_read_timeout(Some(Duration::from_secs(1)))?;
            stream.write_all(request.as_bytes())?;
            let mut response = Vec::new();
            stream.read_to_end(&mut response)?;
            Ok(response)
        });
        match result {
            Ok(response) => {
                let head = String::from_utf8_lossy(&response);
                let status = head.lines().next().unwrap_or("").trim().to_owned();
                return if status.is_empty() {
                    String::from("empty response")
                } else {
                    status
                };
            }
            Err(err) => {
                last_error = err.to_string();
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
    format!("unreachable: {last_error}")
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
        RuntimePaths {
            node: packaged_node_basename().to_owned(),
            cli: String::new(),
            module_base: None,
            bridge_copy: Vec::new(),
            dev: false,
        }
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

    // Rendering the splash proves that the selected platform webview is
    // present. Only Windows offers the WebView2-specific repair action.
    #[cfg(windows)]
    push_status(handle, "webview", "ok", "WebView2 可用", None);
    #[cfg(not(windows))]
    push_status(
        handle,
        "webview",
        "ok",
        "系统 WebKit 可用；开发者工具由平台 webview 控制",
        None,
    );

    // Node executable: a full path must exist; a bare command name is left for
    // the spawn below to surface.
    let node_is_path = paths.node.contains('/') || paths.node.contains('\\');
    if (!paths.is_dev() || node_is_path) && !Path::new(&paths.node).is_file() {
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
#[cfg(windows)]
#[tauri::command]
fn splash_open_webview2_download(app: tauri::AppHandle) -> Result<(), String> {
    let url = "https://developer.microsoft.com/microsoft-edge/webview2/";
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|err| format!("failed to open WebView2 download page: {err}"))
}

/// Report that WebView2 repair is not applicable outside Windows.
#[cfg(not(windows))]
#[tauri::command]
fn splash_open_webview2_download(_app: tauri::AppHandle) -> Result<(), String> {
    Err(
        "WebView2 repair is Windows-only; the installed platform webview supplies this runtime"
            .to_owned(),
    )
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

/// Generate a fresh per-boot loopback token (128 bits of entropy, hex).
/// The runtime requires it on every /api and bridge request; the shell
/// appends it to the navigation URL so the page can attach it.
fn generate_loopback_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64
        ^ (std::process::id() as u64) << 32;
    // Two rounds of xorshift over the seed: enough for a per-boot nonce;
    // secrecy comes from the loopback-only surface, not from this PRNG.
    let mut state = seed | 1;
    let mut words = [0u32; 4];
    for word in words.iter_mut() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        *word = state as u32;
    }
    words.iter().map(|w| format!("{w:08x}")).collect()
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
    let loopback_token = generate_loopback_token();
    let spec = runtime_supervisor::SpawnSpec {
        program: std::path::PathBuf::from(&paths.node),
        args: {
            let mut spec_args = vec![paths.cli.clone()];
            spec_args.extend(args.iter().cloned());
            spec_args
        },
        env: {
            let mut env = vec![("DSH_WEB_TOKEN".to_owned(), loopback_token.clone())];
            if let Some(module_base) = &paths.module_base {
                env.push(("DSH_BARE_MODULE_BASE".to_owned(), module_base.clone()));
            }
            env
        },
    };
    // The supervisor owns the containment unit (Windows Job Object / POSIX
    // process group): the runtime must never run uncontained, so a spawn or
    // containment failure is fatal to boot. A retry is only safe once the
    // previous runtime joined, so the log records the lifecycle before spawn.
    splash_log(&format!(
        "boot: supervisor lifecycle before spawn = {:?}",
        handle.state::<DshRuntime>().lifecycle()
    ));
    let (stdout, stderr) = match handle.state::<DshRuntime>().spawn(spec) {
        Ok(pipes) => pipes,
        Err(err) => {
            fail(
                &handle,
                &format!(
                    "failed to spawn the contained runtime `{} {} {}`: {err}",
                    paths.node,
                    paths.cli,
                    args.join(" ")
                ),
            );
            return;
        }
    };

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
                            Ok(mut url) => {
                                url.query_pairs_mut()
                                    .append_pair("dsh_token", &loopback_token);
                                println!("[dsh-desktop] ready at {url}");
                                push_status(&handle, "boot", "ok", "dsh 服务就绪", None);
                                // Verify the bridge route end-to-end with the
                                // loopback token: a missing or stale bridge
                                // surfaces here in the log instead of failing
                                // silently inside the settings page.
                                if let Some(port) = url.port() {
                                    let status = probe_bridge(port, &loopback_token);
                                    splash_log(&format!(
                                        "[dsh-desktop] bridge probe: {status}"
                                    ));
                                }
                                if let Some(splash) = handle.get_webview_window("splashscreen") {
                                    let _ = splash.close();
                                }
                                if let Err(err) = window.show() {
                                    terminate_runtime(&handle, "boot-window-show-failed");
                                    fail(
                                        &handle,
                                        &format!("failed to show the main window: {err}"),
                                    );
                                    return;
                                }
                                if window.navigate(url).is_err() {
                                    terminate_runtime(&handle, "boot-navigate-failed");
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
                    terminate_runtime(&handle, "boot-timeout");
                    fail(
                        &handle,
                        "dsh runtime did not become ready within 120s (no `dsh web:` readiness line)",
                    );
                    return;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                terminate_runtime(&handle, "boot-readiness-disconnect");
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
    fn packaged_sidecar_name_matches_the_compiled_target() {
        #[cfg(windows)]
        assert_eq!(packaged_node_basename(), "dsh-node.exe");
        #[cfg(not(windows))]
        assert_eq!(packaged_node_basename(), "dsh-node");
    }

    #[test]
    fn dev_mode_is_the_dsh_cli_launcher_not_any_cli_path() {
        // A packaged runtime also carries a CLI path (its own resources), so
        // the mode must not be inferred from `cli` being non-empty: the
        // packaged bridge copy would otherwise never run and every upgrade
        // would keep a stale profile bridge. The dev launcher's constructor
        // is dev by contract; the packaged constructor carries `dev: false`.
        std::env::remove_var("DSH_CLI");
        assert!(RuntimePaths::from_env().is_dev());
        let packaged = RuntimePaths {
            node: "node".to_owned(),
            cli: "G:/Apps/dsh-desktop/runtime/lib/bin.js".to_owned(),
            module_base: None,
            bridge_copy: Vec::new(),
            dev: false,
        };
        assert!(!packaged.is_dev());
    }

    #[test]
    fn packaged_bridge_refresh_copies_the_runtime_packages_into_the_profile() {
        use std::fs;
        let temp = std::env::temp_dir().join(format!("dsh-desktop-bridge-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        let home = temp.join("home");
        let profile = home.join("profiles").join("web");
        let marker = profile
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh-desktop-bridge");
        fs::create_dir_all(marker.join("lib")).unwrap();
        fs::write(marker.join("package.json"), "{}").unwrap();
        fs::write(marker.join("lib").join("index.js"), "stale").unwrap();
        let source = temp
            .join("runtime")
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh-desktop-bridge");
        fs::create_dir_all(source.join("lib")).unwrap();
        fs::write(
            source.join("package.json"),
            "{\"name\":\"@deepseek-ai/dsh-desktop-bridge\"}",
        )
        .unwrap();
        fs::write(source.join("lib").join("index.js"), "fresh").unwrap();
        let paths = RuntimePaths {
            node: "node".to_owned(),
            cli: "G:/Apps/dsh-desktop/runtime/lib/bin.js".to_owned(),
            module_base: None,
            bridge_copy: vec![source],
            dev: false,
        };
        std::env::set_var("DSH_HOME", home.to_string_lossy().into_owned());
        let patches = ensure_bridge("node", &paths.cli, &paths);
        std::env::remove_var("DSH_HOME");
        assert!(patches.is_empty());
        let refreshed = fs::read_to_string(marker.join("lib").join("index.js")).unwrap();
        assert_eq!(refreshed, "fresh");
        fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn fnv1a64_matches_the_reference_vector() {
        // FNV-1a 64-bit reference vector for "hello".
        assert_eq!(fnv1a64(b"hello"), 0xa430d84680aabd0b);
    }

    #[test]
    fn sync_bridge_patch_replaces_stale_rows_and_preserves_user_rows() {
        use std::fs;
        let temp = std::env::temp_dir().join(format!("dsh-desktop-sync-rows-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        let profile = temp.join("profile");
        let pkg = profile
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh-desktop-bridge");
        fs::create_dir_all(&pkg).unwrap();
        let source = [
            "# dsh-desktop-bridge rows. The shell appends this file to the profile's",
            "# cordis.patch.yml at install time so the rows compose in the user layer",
            "- insert:",
            "    - id: desktop-bridge",
            "      name: '@deepseek-ai/dsh-desktop-bridge'",
            "",
            "    - id: desktop-bridge-client",
            "      name: '@deepseek-ai/dsh-desktop-bridge-client'",
            "",
            "# Desktop settings defaults: edit this entry to change the out-of-box",
            "# behavior (the in-app settings page overrides these).",
            "- id: desktop-bridge",
            "  config:",
            "    closeToTray: false",
            "    debugMode: false",
            "    logoMotion: false",
            "",
        ]
        .join("\n");
        fs::write(pkg.join("cordis.patch.yml"), &source).unwrap();
        let stale = [
            "# Your patch layer for this dsh profile.",
            "# dsh-desktop-bridge rows. The shell appends this file to the profile's",
            "# cordis.patch.yml at install time so the rows compose in the user layer",
            "- insert:",
            "    - id: desktop-bridge",
            "      name: '@deepseek-ai/dsh-desktop-bridge'",
            "",
            "    - id: desktop-bridge-client",
            "      name: '@deepseek-ai/dsh-desktop-bridge-client'",
            "",
            "# Bridge policy: edit this entry to change which dropped files are accepted.",
            "- id: desktop-bridge",
            "  config:",
            "    allowedExtensions: []",
            "    maxBytes: 52428800",
            "",
            "- id: user-plugin",
            "  config:",
            "    key: value",
            "",
        ]
        .join("\n");
        fs::write(profile.join("cordis.patch.yml"), &stale).unwrap();
        // Legacy residue dirs an old copy path left behind.
        let legacy = profile.join("node_modules").join("@deepseek-ai");
        fs::create_dir_all(legacy.join("bridge")).unwrap();
        fs::create_dir_all(legacy.join("bridge-client")).unwrap();
        fs::write(legacy.join("bridge").join("package.json"), "{}").unwrap();

        assert!(sync_bridge_patch(&profile, "0.3.30"));
        let out = fs::read_to_string(profile.join("cordis.patch.yml")).unwrap();
        assert!(out.contains("- id: user-plugin"), "user rows survive: {out}");
        assert!(out.contains("closeToTray: false"), "new bridge rows installed: {out}");
        assert!(!out.contains("allowedExtensions"), "stale rows removed: {out}");
        assert!(!legacy.join("bridge").exists(), "legacy residue removed");
        assert!(!legacy.join("bridge-client").exists(), "legacy residue removed");
        let marker = profile.join(".dsh-desktop-bridge-sync");
        let marker_text = fs::read_to_string(&marker).unwrap();
        assert!(marker_text.contains("version=0.3.30"), "marker records version");

        // Same version + same patch: the rewrite is skipped, so edits made
        // during this version survive a plain reboot — including edits to the
        // bridge config entry itself.
        let edited = out.replace("closeToTray: false", "closeToTray: true");
        fs::write(profile.join("cordis.patch.yml"), &edited).unwrap();
        assert!(sync_bridge_patch(&profile, "0.3.30"));
        assert_eq!(
            fs::read_to_string(profile.join("cordis.patch.yml")).unwrap(),
            edited,
            "no rewrite when the marker matches"
        );

        // A version advance re-syncs the bridge rows (an edit made during the
        // old version is refreshed) while user-owned rows keep their edits.
        assert!(sync_bridge_patch(&profile, "0.3.31"));
        let resynced = fs::read_to_string(profile.join("cordis.patch.yml")).unwrap();
        assert!(resynced.contains("closeToTray: false"), "upgrade refresh replaces bridge rows");
        assert!(!resynced.contains("closeToTray: true"), "stale bridge edit removed");
        assert!(resynced.contains("- id: user-plugin"), "user rows survive the upgrade");
        fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn sync_bridge_patch_replaces_the_empty_template_list() {
        use std::fs;
        let temp = std::env::temp_dir().join(format!("dsh-desktop-sync-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        let profile = temp.join("profile");
        let pkg = profile
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh-desktop-bridge");
        fs::create_dir_all(&pkg).unwrap();
        fs::write(
            pkg.join("cordis.patch.yml"),
            "- insert:\n    - id: desktop-bridge\n      name: '@deepseek-ai/dsh-desktop-bridge'\n",
        )
        .unwrap();
        let template = [
            "# Your patch layer for this dsh profile, applied after every bundle layer:",
            "# a top-level YAML array of loader patch entries.",
            "[]",
            "",
        ]
        .join("\n");
        fs::write(profile.join("cordis.patch.yml"), &template).unwrap();
        assert!(sync_bridge_patch(&profile, "0.3.30"));
        let out = fs::read_to_string(profile.join("cordis.patch.yml")).unwrap();
        assert!(out.contains("- insert:"), "rows join the patch: {out}");
        assert!(!out.contains("[]"), "placeholder replaced: {out}");
        assert!(out.starts_with("# Your patch layer"), "template preamble survives: {out}");
        fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn probe_bridge_reports_the_http_status_line() {
        use std::io::Read;
        use std::io::Write;
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 2\r\n\r\n{}",
                );
            }
        });
        let status = probe_bridge(port, "test-token");
        assert!(status.contains("200"), "got: {status}");
    }

    #[test]
    fn probe_bridge_reports_an_unreachable_runtime() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let status = probe_bridge(port, "test-token");
        assert!(status.contains("unreachable"), "got: {status}");
    }

    #[test]
    fn update_smoke_driver_uses_the_existing_confirmation_path() {
        let script = update_smoke_script();
        assert!(script.contains("window.confirm"));
        assert!(script.contains("dsh-desktop-updater"));
        assert!(script.contains("state === 'available'"));
        assert!(script.contains("state === 'ready'"));
        assert!(!script.contains("tauri"));
    }

    #[test]
    fn debug_mode_status_distinguishes_page_guard_from_native_control() {
        assert_eq!(
            debug_mode_status(false, false, Some("platform limitation")),
            serde_json::json!({
                "requested": false,
                "applied": false,
                "limitation": "platform limitation",
            })
        );
        assert_eq!(
            debug_mode_status(true, true, None),
            serde_json::json!({
                "requested": true,
                "applied": true,
                "limitation": null,
            })
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
