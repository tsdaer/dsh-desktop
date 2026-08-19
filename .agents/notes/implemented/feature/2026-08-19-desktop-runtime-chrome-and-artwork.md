# Agent Note: Desktop Runtime Chrome and Artwork

Status: implemented

English | [中文](2026-08-19-desktop-runtime-chrome-and-artwork.zh.md)

## Problem

The desktop title bar exposed a balance amount without an explicit API connection state or a direct refresh action. The splash artwork and packaged icon files did not share a local verified source, and the native shell had no bounded workload indicator for the application and its managed runtime.

## Decision

The bridge balance response now carries one of `connected`, `unavailable`, or `unconfigured` alongside the credential-safe balance projection. The title bar starts in `checking`, renders the four explicit API states, and keeps the last successful balance when a refresh fails. The balance control is keyboard accessible, exposes `aria-busy` during a request, refreshes on click and visibility, and deduplicates concurrent requests.

The Rust shell owns a persistent `sysinfo` sampler. It measures the desktop process and the managed runtime process tree, combines normalized process CPU and memory pressure, and returns only `unknown`, `calm`, `active`, `busy`, or `saturated`. The first sample is neutral; asymmetric transition thresholds and a four-second minimum dwell prevent rapid tier changes. Missing processes, unsupported measurements, and sampling failures return `unknown` without affecting boot or agent execution.

The remote main-window capability explicitly grants `allow-runtime-status`; the command remains unavailable to other windows by omission. A rejected status invocation therefore cannot be mistaken for a valid workload sample.

The canonical artwork is `apps/desktop/src/icon.svg`, a transparent black fish asset served by the splash page. `gen-icons.mjs` rasterizes it into 16, 32, 48, 256, and 512 pixel PNGs and a multi-size ICO. The splash places the SVG on a light neutral backing shape so the black mark remains visible on the dark splash theme.

## Testing

Rust unit tests pin tier thresholds, asymmetric hysteresis, and minimum dwell. Bridge/client builds, icon generation, and focused desktop Vitest coverage pass. `cargo check` resolves and compiles `sysinfo` but the Tauri build script is currently blocked by a Windows permission error while writing its generated permission directory; the same source compiles and its Rust tests pass when Cargo uses a clean repository-local target directory.

## Alternatives considered

**Expose raw process metrics to the browser.** Rejected because the title bar needs a small workload label, not process inventory or host telemetry. The native command returns only a normalized tier.

**Add a separate API-health request.** Rejected because it would duplicate credential resolution and create a second provider failure path. The existing balance proxy is the single credential-safe request used for both state and amount.

**Keep the upstream colored FishLogo as the icon source.** Rejected because splash, installer, tray, and window assets need one desktop-owned black source with deterministic verification. The source now lives under the desktop frontend and the generated files are derived from it.

## Consequences

The title bar adds a compact status cluster that must retain its labels and controls at narrow window widths. Workload sampling adds the `sysinfo` dependency and a low-frequency native process refresh, while the neutral fallback keeps telemetry non-critical. Regenerating icons requires `sharp`; the generator fails instead of silently producing a placeholder when the required rasterizer is unavailable.
