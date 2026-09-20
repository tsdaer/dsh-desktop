# Agent Note: Browser-session cookie names one slot per host

Status: implemented

English | [中文](2026-09-20-webview-cookie-accumulation.zh.md)

## Problem

`BrowserAuth.cookieName` hashed the full request authority (hostname plus port) into the persistent browser-session cookie's name. Browsers store cookies per host and cannot scope them by port, and the desktop shell spawns the web runtime with `--port 0`, so every application boot minted a cookie under a fresh name while every earlier cookie stayed in the jar for its configured lifetime (30 days by default). A WebView2 profile that had booted the application 64 times carried a 14,530-byte `Cookie` header. The browser bootstrap fetches every web plugin as one combo script whose URL lists all module paths in the query string (~3 KB with 59 plugins); request line plus accumulated cookies exceeded node:http's default 16 KB request-head limit, the server answered HTTP 431 for `/plugins/` combos, and the page reported every entry as "import failed" under "web boot: 59 entries did not activate". A fresh browser profile showed no failure, which hid the cause during diagnosis.

## Decision

The deterministic cookie name hashes the hostname alone, so sibling ports of one host share a single jar slot and each mint overwrites the previous entry. The signed payload keeps binding hostname plus port, so verification is unchanged: a cookie still never authorizes a different port or host. The token exchange also expires every other `dsh-auth-*` cookie the request carries, which removes entries left by the earlier per-port names the first time an upgraded application completes a login.

## Alternatives considered

- **Raise the webserver's request-head limit.** Rejected as the only measure: the jar keeps growing without bound and the failure returns after enough boots.
- **Clear WebView2 cookies from the desktop shell.** Rejected: Tauri 2 does not expose the WebView2 cookie manager, and browsers running `dsh web` accumulate the same entries.
- **Spawn the desktop runtime on a fixed port.** Rejected: it trades random-port isolation for port conflicts and still does not remove cookies already accumulated.

## Consequences

One jar slot per host bounds the `Cookie` header to a single session entry. Concurrent sessions of the same host on different ports displace each other: the tab whose cookie was replaced must reopen the URL its `dsh web` process printed. Fixed-port terminal usage keeps cookie persistence across server restarts exactly as before.

## Verification

WebView2 remote debugging on the installed 0.5.14 application showed the 431 responses on `/plugins/` combos and 64 accumulated `dsh-auth-*` cookies; clearing the jar restored full boot. `browser-auth.host.spec.ts` covers the shared name across ports, the unchanged payload port binding, and the exchange-time expiry of superseded names.
