# Agent Note: Desktop target-native runtime validation

Status: implemented

English | [中文](2026-08-22-desktop-target-native-runtime.zh.md)

## Problem

The target-owned runtime directory could be selected correctly while its native dependencies still contained another platform's prebuild or no loadable binary for the selected target. Booting with the target sidecar is necessary but does not identify an invalid native inventory before the package is assembled.

## Decision

`apps/desktop/scripts/runtime-native.mjs` owns native runtime pruning and validation. The bake walks every `prebuilds` directory, keeps a native file under the target row's `nativePlatformKey` when available, or accepts a source-built native file beside that directory, and removes the other children before inspecting the resulting runtime. When `node-pty` is present, its package must contain a loadable native file. Koffi may contain that file directly or in its target-specific `@koromix/koffi-<nativePlatformKey>` optional package; another target's optional package does not satisfy the check. Every shipped `.node`, `.dll`, `.dylib`, `.so`, or `.exe` is checked for a supported foreign-platform path key and for an extension that cannot run on the selected OS.

The validator runs after target-specific pruning and before the sidecar boot smoke. It does not infer compatibility from a filename for generic native files such as `koffi.node`; the target runner's sidecar boot remains the evidence that those bytes load on the target operating system.

## Testing

`apps/desktop/scripts/runtime-native.spec.mjs` verifies multi-package pruning, missing target prebuilds, source builds, Koffi's target-specific optional-package layout, and foreign native files. The desktop bundle runs the target, sidecar, and native-runtime script tests together before fetching and booting the target sidecar.

## Consequences

Runtime baking fails before sidecar boot when the native inventory is incomplete or contains a detectable foreign-platform file. Generic native filenames still require target-runner boot evidence, so this check narrows the failure space without turning a Windows host check into cross-platform support evidence.

## Related

The target rows are defined by the [desktop target specification](2026-08-22-desktop-target-specification.md), sidecar acquisition is defined by the [portable Node sidecar](2026-08-22-desktop-portable-node-sidecar.md), and the shell startup wiring is defined by the [cross-platform shell runtime](2026-08-22-desktop-cross-platform-shell-runtime.md).

## Alternatives considered

**Validate only `node-pty`.** Rejected because other packages can ship prebuild directories or native helpers and would remain outside the target check.

**Treat every `.node` file as portable.** Rejected because a successful Windows bake could then carry a POSIX addon into a later target directory; generic filenames are accepted only for the target-runner boot to prove.

**Compile-test all targets from Windows.** Rejected because native addon loading and WebKit/Tauri linkage require the target operating system; cross-target source checks do not establish packaged runtime evidence.
