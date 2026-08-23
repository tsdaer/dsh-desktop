# Agent Note: Nested pnpm invocation accepts a native entrypoint

Status: implemented

English | [中文](2026-08-21-nested-pnpm-native-entrypoint.zh.md)

## Problem

Repository orchestrators that re-enter pnpm must preserve the package-manager distribution that started them. The gate, build, Web snapshot, coverage, and desktop bundle coordinators run in environments where `npm_execpath` may name either a JavaScript file or a native executable. Assuming one form breaks the other: npm-installed pnpm and `pnpm/action-setup` expose a JavaScript entrypoint, while a standalone pnpm install exposes a native executable such as `pnpm.exe`.

On a standalone install Node parsed the executable header as source, so every nested command died instantly with `SyntaxError: Invalid or unexpected token` on the `MZ` magic bytes. `pnpm run doc-sync` reported all 28 gates failing in under a second each and `pnpm run build` failed in `build:lib`, while each gate passed when invoked directly. The uniform, instant failures read like 28 unrelated defects rather than one unsupported package-manager installation.

## Decision

`scripts/package-manager.ts` owns the rule as `packageManagerInvocation(args, context)`, returning the executable plus its complete argument list. A JavaScript entrypoint (`.js`, `.cjs`, `.mjs`) is handed to Node as before; anything else is spawned directly, which is what a native pnpm binary requires. Both forms stay shell-free, so the [scripts convention](../../../../scripts/AGENTS.md) holds on every host.

The repository gate, build, Web snapshot, coverage, and desktop bundle coordinators consume that one helper. `CoverageCommand` has an explicit `command` field and `CoveragePartitionCoordinatorOptions` carries a `packageManager` invocation, because a coordinator command cannot assume Node is the executable. The plain-Node desktop bundle imports the same TypeScript source and never resolves a `pnpm.cmd` shim from `PATH`.

## Alternatives considered

- **Spawn `pnpm` from `PATH`.** Rejected because it loses the exact package manager that started the process, and the original comment's hazard is real: on Windows a `pnpm.cmd` shim cannot be spawned without a shell.
- **Detect the standalone install by platform.** Rejected because the distinction is the entrypoint's form, not the operating system; a Windows npm-installed pnpm still needs the Node loader.
- **Probe the file's first bytes for `MZ` or a shebang.** Rejected because the extension already answers the question, and reading a file to decide how to spawn it adds an I/O failure mode to every gate startup.
- **Require a JavaScript entrypoint and fail loudly.** Rejected because the standalone install is a supported pnpm distribution; refusing it would make the repository unusable on a working setup rather than fixing an unnecessary assumption.

## Consequences

Nested orchestration works on npm-installed, action-setup, and standalone pnpm. A future call site must go through the helper; reading `npm_execpath` directly reintroduces the same defect for the standalone install, while resolving `pnpm.cmd` from `PATH` cannot stay shell-free on Windows.

CI action-setup installations re-enter their JavaScript entrypoint through Node. Standalone installations spawn their native executable directly. Neither path invokes a platform shell.

## Verification

`scripts/package-manager.spec.ts` pins the JavaScript and native forms, the unavailable entrypoint, and that a native entrypoint is never handed to Node. `pnpm run doc-sync` now reports 28 passed, 0 failed on a standalone pnpm install, where it previously reported 28 failed; `pnpm run typecheck` and the affected script suites pass.
