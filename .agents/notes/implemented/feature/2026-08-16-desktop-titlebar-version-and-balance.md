# Agent Note: Desktop title bar shows the app version and the DeepSeek balance

Status: implemented

English | [中文](2026-08-16-desktop-titlebar-version-and-balance.zh.md)

## Problem

The dsh-desktop window is frameless and draws its own title bar (apps/desktop/src/titlebar.js, injected by the Rust host into the dsh web page). It showed only the app title and the window controls, so a user could not tell which app version they run, and the DeepSeek account balance — the resource every request spends — was only visible on the platform website. The title bar needed the version next to the title and a balance display on the right.

## Decision

**Version badge.** main.rs prepends a `window.__DSH_DESKTOP_VERSION__` global before eval'ing titlebar.js into the dsh page; the value comes from `handle.package_info().version` (tauri.conf.json's version, synced from apps/desktop/package.json by scripts/sync-version.mjs). titlebar.js renders a `v<version>` badge span beside the title inside the drag strip. The loading page loads the same file as a plain script tag and has no global, so it renders the bare title — the script stays the single source of truth for both pages.

**Balance pill.** The title bar shows a small pill (coin glyph + amount, tooltip `余额`) before the window controls. The data path keeps the API key entirely inside the runtime:

1. titlebar.js polls the same-origin route `GET /dsh-bridge/balance` immediately, every 5 minutes, and on window visibility (each fetch aborts after 8 s). The pill stays hidden until the first successful read; a failed refresh keeps the last good amount; `balanceEverShown` distinguishes the pre-first-success state.
2. The desktop bridge host (apps/desktop/bridge) serves the route: `resolveBalanceKey` resolves `credentialRef('DEEPSEEK_API_KEY')` through the runtime's credentials seam (the same reference and ordering llm-deepseek uses), falling back to `process.env.DEEPSEEK_API_KEY` when the seam is absent; `handleBalance` then proxies the official `{base}/user/balance` endpoint (`DEEPSEEK_BASE_URL` or `https://api.deepseek.com`, 10 s timeout) with the Bearer key.
3. The route returns a normalized `{ ok, currency, totalBalance }` (from the first `balance_infos` entry) on success; failures stay a 200 with a machine-readable `reason` (`unconfigured` / `auth` / `api` / `network`) so the pill renders a hidden or stale state instead of logging fetch errors. The amount is pure presentation — no session event, no model-visible input.

The bridge host declares `@deepseek-ai/dsh-credentials` as peer + dev dependency (the llm-deepseek pattern); the value import stays external in the tsdown bundle and resolves at runtime from the profiles module fallback (dev) or the baked runtime (packaged, via `DSH_BARE_MODULE_BASE`).

## Alternatives considered

**A Tauri command fetching the balance in Rust** — rejected. The shell process has no access to the API key (it lives in the runtime's credentials store or environment), would need its own HTTP client, and the runtime already owns key resolution in-process.

**The page calling the DeepSeek API directly** — rejected. It would force CORS and put the API key in the browser; the whole point of the bridge route is that the key never leaves the runtime.

**Adding the balance route to llm-deepseek** — rejected. Balance display is a desktop shell integration; the bridge host is the established shell seam (drops, policy, debug mode), so the blast radius stays inside apps/desktop.

**Baking the version into titlebar.js at build time** — rejected. The file is loaded by two surfaces (loading page script tag and injected eval); a runtime global keeps one file and always matches the actually packaged version.

## Consequences

The pill shows the live balance with no key configured → hidden (the common case on first run, and it stays hidden instead of nagging). Each visible refresh costs one authenticated request to the platform on a 5-minute cadence — negligible, and no balance read ever enters the session log. The bridge host gains a runtime dependency on the credentials seam; the peer declaration follows the llm-deepseek precedent and the import resolves in both dev and packaged layouts.

## Verification

An end-to-end boot of the real web profile (throwaway DSH_HOME, bridge installed, credentials absent) answered `GET /dsh-bridge/balance` with `{"ok":false,"reason":"unconfigured"}`; with `DEEPSEEK_API_KEY` set and `DEEPSEEK_BASE_URL` pointed at a local mock of `/user/balance`, it answered `{"ok":true,"available":true,"currency":"CNY","totalBalance":"110.00"}`. The bridge package typechecks and builds (tsc + tsdown) with the new external import.
