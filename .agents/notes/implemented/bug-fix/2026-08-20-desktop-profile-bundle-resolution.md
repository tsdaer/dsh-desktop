# Agent Note: Packaged desktop preserves profile-owned bundles

Status: implemented

English | [中文](2026-08-20-desktop-profile-bundle-resolution.zh.md)

## Problem

The packaged dsh-desktop shell passed the runtime's `lib/bin.js` as `DSH_BARE_MODULE_BASE` for every bare loader specifier. That made the closed runtime authoritative for built-in packages, but it also hid bundles installed in the user's profile. An upgrade therefore made a valid profile fail before the `dsh web:` readiness line when its bundle was absent from the packaged runtime.

## Decision

Packaged `RuntimePaths` preserves an explicitly configured `DSH_BARE_MODULE_BASE` but leaves it unset by default. `healProfilesModuleFallback` links the built-in dependency closure into `$DSH_HOME/profiles/node_modules`, so built-in packages still resolve from the packaged runtime while profile-owned bundles resolve from the profile's `node_modules`. The runtime bake verification uses the same unset default.

## Alternatives considered

- **Keep the runtime-only base.** Rejected because it makes profile-installed bundles unresolvable after an application update.
- **Copy every profile bundle into the installer.** Rejected because user bundles are outside the application payload and may be local links or independently updated packages.
- **Remove the explicit module-base override.** Rejected because hosts that own a complete plugin set still need the `boot()` resolution option.

## Consequences

Packaged dsh-desktop keeps the runtime closure self-contained for built-in packages without taking ownership of the user's profile bundle set. A profile with a missing or invalid bundle still fails loudly; the fix only restores the intended Node resolution locations.

## Verification

The installed runtime at `G:\Apps\dsh-desktop` reproduced the missing `dsh-whale-widget` failure with the runtime-only base and reached `dsh web: http://127.0.0.1:<port>` with the base unset while resolving the existing profile link.
