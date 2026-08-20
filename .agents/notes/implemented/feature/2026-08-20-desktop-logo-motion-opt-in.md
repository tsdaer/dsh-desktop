# Agent Note: Desktop Logo hover motion is an explicit opt-in

Status: implemented

English | [中文](2026-08-20-desktop-logo-motion-opt-in.zh.md)

## Problem

The New Session hero Logo animation is disabled when the host reports reduced motion. Desktop users need a product setting for this small decorative cue without changing motion behavior for browser users or other animations.

## Decision

The desktop bridge owns a persisted `logoMotion` boolean in the `desktop-bridge` settings namespace. Its default is `false`, so the system reduced-motion preference remains authoritative until the user explicitly enables this setting. The bridge client mirrors the enabled value to `html[data-dsh-logo-motion]`, and the shared hero stylesheet uses that attribute to allow only the fish Logo hover animation to run under reduced motion. The setting is exposed in the Desktop settings section and saves through `/dsh-bridge/policy`.

## Alternatives considered

**Remove the reduced-motion condition globally.** Rejected because it would force decorative motion on browser users and ignore an accessibility preference.

**Add a shared General setting.** Rejected because this behavior exists only in the desktop shell and the shell already owns the bridge settings route and section.

## Consequences

The desktop setting is durable and applies without restarting the app. Browser clients do not receive the desktop root attribute and retain the upstream reduced-motion behavior. The explicit opt-in is intentionally limited to the New Session hero Logo; it does not enable other CSS animations.
