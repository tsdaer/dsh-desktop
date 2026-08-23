# Agent Note: Desktop cross-platform shell runtime wiring

Status: implemented

English | [中文](2026-08-22-desktop-cross-platform-shell-runtime.zh.md)

## Problem

The desktop shell resolved a packaged runtime by looking for `node.exe` and could fall back to ambient Node when packaged resources were missing. WebView2 controller calls and repair UI were also compiled and described as if every platform supplied the same webview API.

## Decision

Packaged startup uses the product-owned Tauri external-binary basename: `dsh-node.exe` on Windows and `dsh-node` on POSIX. The target-suffixed name belongs to source staging and is removed by Tauri while it copies the external binary into the application. Release startup checks the installed sidecar and runtime paths as files and does not fall back to a PATH-provided Node; development retains the `DSH_CLI`/`DSH_NODE` environment wiring.

WebView2 controller access is compiled only on Windows. Other targets retain the page-level debug guard and return a status with `applied: false` and an explicit platform limitation because runtime developer-tool control belongs to the platform webview. The WebView2 repair command remains available only as a Windows action and returns an explicit unsupported-platform error elsewhere. Splash status uses the platform-neutral `webview` identifier. Windows Explorer registration and native window chrome remain cfg-gated Windows integrations.

Runtime baking invokes the target sidecar for profile initialization and readiness verification, terminates the spawned process tree, and fails before boot verification when the sidecar has not been fetched. The bundle command fetches the sidecar before baking so this invariant holds for every target.

## Testing

The Rust source compiles on the host with a temporary build configuration that omits unavailable packaged resources, and `cargo fmt -- --check` passes. Rust tests pin the platform-installed sidecar basename; script syntax and target-sidecar tests pass. Native Linux and macOS linkage, packaged installation, and target-runner boot evidence remain open work-package requirements.

## Related

Target-native pruning and native-file validation are defined by the [desktop target-native runtime](2026-08-22-desktop-target-native-runtime.md) note. The corrected distinction between source and installed sidecar names is recorded in [desktop packaged sidecar naming](../bug-fix/2026-08-23-desktop-packaged-sidecar-naming.md).

## Alternatives considered

**Use ambient Node when the installed sidecar is absent.** Rejected because release startup must remain self-contained and versioned.

**Compile WebView2 calls for all targets.** Rejected because the controller API is Windows-specific; non-Windows status now states the platform limitation instead of claiming runtime control.

**Let runtime baking use the host `node`.** Rejected because a successful host boot would not prove that the packaged target sidecar can execute the baked runtime.

## Consequences

Development and release startup have distinct runtime contracts: development may use PATH Node, while packaged startup requires target-owned files. The Windows splash repair action and Explorer/chrome integrations remain Windows-only; Linux and macOS need platform-native packaging and GUI evidence before release support can be declared.
