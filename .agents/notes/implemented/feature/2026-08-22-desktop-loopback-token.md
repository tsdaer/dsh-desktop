# Agent Note: Desktop loopback token

Status: implemented

English | [中文](2026-08-22-desktop-loopback-token.zh.md)

## Problem

The runtime serves on loopback with no authentication, so any local process can reach the API: read and mutate sessions, drive tools, read Workspace files. The desktop shell is the only client that knows the port, so it can hold a per-boot secret the plain browser posture does not need.

## Decision

The shell generates a fresh 128-bit token per boot, passes it to the runtime as `DSH_WEB_TOKEN`, and appends it to the navigation URL as `?dsh_token=...`. The web composition wires the environment variable into the webserver row's optional `token` config.

`@deepseek-ai/dsh-host-webserver` gains an optional `token` config: when set, every registered (non-fallback) route and every upgrade requires `Authorization: Bearer <token>` (or the `dsh_token` query parameter for WebSockets, which cannot set headers); the static dist fallback stays open so the page can load before the client learns the token. Comparison is length-plus-scan so a mismatch does not leak its prefix. Omitted, the plain loopback posture is exactly unchanged.

The browser captures the token when its connection modules load. `@deepseek-ai/dsh-client-connection` attaches it to every typed API fetch, generic Remote RPC fetch, and WebSocket; the desktop bridge client attaches it to every `/dsh-bridge` request. Capturing at module load preserves the secret if later navigation removes the query string.

## Alternatives considered

**Require the token on the static dist too** — rejected: the page must load before any script can read the token, so the bootstrap request cannot carry it; the dist contains no session data.

**Reuse the hostname trust fence** — rejected: the fence distinguishes loopback from LAN authorities, but any local process is already loopback; the token adds a per-boot secret the fence cannot express.

**A fixed shared secret** — rejected: one leaked constant protects nothing; the token is per-boot and never persisted.

## Consequences

The browser-only posture (no `DSH_WEB_TOKEN`, no `?dsh_token`) is byte-for-byte unchanged: no token config means no checks, and no URL query means no headers. The token rides the loopback URL query, which a malicious local process could observe only by already having local access; the token's value is raising the bar from "any process" to "a process that read the window's URL", not defending a compromised host.

## Testing

Webserver tests pin route and upgrade refusal without the token, acceptance with the header, query-token upgrades, and the open fallback. Connection tests pin typed and generic RPC fetch header attachment and WebSocket query attachment, with module reset between cases. Bridge-client tests pin header merging, validated JSON responses, HTTP failures, and the no-token pass-through. `cargo check` compiles the shell token generation and navigation.
