# Agent Note: Desktop development plan after 0.3

Status: proposed

English | [中文](2026-08-21-desktop-post-0.3-plan.zh.md)

## Problem

The desktop edition has published `v0.3.0` through `v0.3.4`, and [the 0.3 proposal](2026-08-17-desktop-0.3-worktree-and-runtime-chrome.md) still owns an open tail: the P5 smoke matrix, the GUI evidence it requires, and the ordinary-message copy audit. Nothing states what follows that tail, in what order, or what finishing each item means.

An agent picking up desktop work therefore re-derives the backlog from source every time, and re-derives it inconsistently: the read-only Source Control view, the absent file viewer, the Windows-only packaging, and the frameless-title-bar gaps are each discoverable only by reading code or the README's prose. Ordering is the part that source cannot answer at all — several items are cheap once the evidence tooling exists and expensive before it.

The environment compounds this. Producing GUI evidence for a desktop-only plugin needs a composition no ordinary command builds, [`apps/desktop/docs/operating-constraints.md`](../../../../apps/desktop/docs/operating-constraints.md) asserts a process topology that is false when the application runs from an installed location, and a local packaged build cannot complete without a signing key. Each of those costs a session to rediscover and pushes an agent toward either unnecessary caution or an unsafe assumption.

## Proposal

Seven ordered phases. Each is independently reviewable, states what done means, and names the evidence a reviewer can check. The 0.3 tail stays with its own note; this note fixes only its position in the order. Phase 2 comes before every product phase because it is what makes their evidence obtainable.

Phases 3 through 7 are independent of each other and may be reordered on product grounds. Phase 2 is not optional for any of them.

### Phase order

| Phase | Subject | Depends on |
|---|---|---|
| 1 | Close the 0.3 tail | — |
| 2 | Repeatable evidence environment | — |
| 3 | Source Control writes | 2 |
| 4 | In-app file viewing | 2 |
| 5 | Native chrome and loopback posture | 2 |
| 6 | A second platform | 2, and a complete harness Linux story |
| 7 | Dormant-capability payload decision | — |

### Phase 1: close the 0.3 tail

[The 0.3 proposal](2026-08-17-desktop-0.3-worktree-and-runtime-chrome.md) owns the criteria; do not restate them here. Two facts belong to ordering. The published `v0.3.4` installer is the artifact the smokes run against, so no local packaged build is required. The Explorer context-menu keys are removed by an uninstall hook whose end-to-end behavior is unverified: installing a packaged build replaces an existing installation of the same identifier, so the uninstall smoke needs a machine that is not serving the session under test.

### Phase 2: repeatable evidence environment

The desktop Workbench mounts through the shared sidebar slot and reads the bridge Host over HTTP, so the composition a browser must load is: a scratch `DSH_HOME`, the bridge packages installed into the profile the way the shell installs them, the bridge rows merged into the profile patch layer, and at least one registered Workspace. Building that by hand is the current cost.

Add `apps/desktop/scripts/evidence-server.mjs`: one command that creates a scratch home, boots once to materialize the profile and its healed module fallback, installs `bridge` and `bridge-client` into `profiles/node_modules/@deepseek-ai/`, merges `bridge/cordis.patch.yml` into the profile's `cordis.patch.yml`, registers a Workspace, and serves a fixed port, printing the readiness URL. Leave `@deepseek-ai/schemastery` alone: the profile fallback owns that path as a symlink and a real directory there fails the boot.

Correct `operating-constraints.md` in the same phase. It must tell an agent how to determine which runtime is live — inspect the running process's executable path and its spawned Node command line — instead of asserting that the serving runtime is built from the working directory. Both topologies occur, and only the measurement distinguishes them.

### Phase 3: Source Control writes

[Read-only decorations](../../implemented/feature/2026-08-19-desktop-worktree-source-control.md) ship today. Add staging, unstaging, discarding, committing with a message, and viewing a file's diff, through the same bounded Host adapter that owns the fixed Git argv, environment, output cap, cancellation, and canonical-root checks. The browser continues to send a Workspace id and a Workspace-relative path, never argv.

Whole-file operations only. Hunk and line staging need a diff model the Host does not have and belong to a later phase. Discarding and unstaging are destructive, so each requires an explicit confirmation that names the file, and neither is offered for an entry the status parse did not classify. Diff viewing reuses the existing diff presentation rather than adding a second renderer. Git worktree checkout management stays out of scope; the 0.3 proposal already records why it needs its own design.

### Phase 4: In-app file viewing

Explorer and Search can locate a file but not show it. Add a read-only viewer for an in-root file: bounded bytes with an explicit truncation state, binary and non-UTF-8 detection that refuses rather than renders, and highlighting through the client's existing highlighter. Opening a Search result scrolls to the matched line.

Complete: the bridge's `GET /worktree/file` route serves strict UTF-8 with truncation and binary refusal, `DesktopWorkspaceFileViewer` renders Explorer and Search opens with matched-line scrolling, and the shipped behavior is recorded in [the implemented file viewer note](../../implemented/feature/2026-08-22-desktop-file-viewer.md).

Editing is a separate phase. It requires save-conflict detection, encoding and line-ending policy, and an undo model, none of which a viewer needs.

### Phase 5: native chrome and loopback posture

Three frameless-window gaps are known and user-visible: no Windows 11 snap-layout flyout, resize borders left to tao's default hit-testing, and a maximize icon that syncs on click and resize events rather than on window state. Fix them as one chrome pass with the state read from the window rather than inferred from input.

Separately, the runtime serves loopback with no authentication, which any local process can reach. The desktop shell is the only client that knows the port, so it can hold a per-boot token. This changes `dsh web`, which is upstream-owned: it needs an independent harness need, a row in [the divergence register](../../../../docs/fork-divergence.md), and a design that leaves the browser-only posture unchanged when no token is configured.

The chrome pass is complete: the main window re-adds `WS_THICKFRAME` (without `WS_CAPTION`) so the OS provides resize borders and the Windows 11 snap-layout flyout, and the native host pushes `dsh://maximize-change` on every size event so the title-bar icon follows window state ([implemented note](../../implemented/feature/2026-08-22-desktop-native-window-chrome.md)). The loopback token is complete: the shell generates a per-boot token and passes it as `DSH_WEB_TOKEN` plus the navigation query, the webserver's optional `token` config enforces it on registered routes and upgrades while the static dist stays open, and both the connection client and the bridge client attach it ([implemented note](../../implemented/feature/2026-08-22-desktop-loopback-token.md), [divergence rows](../../../../docs/fork-divergence.md)).

### Phase 6: a second platform

Linux before macOS, because macOS adds signing and notarization. Four blockers are concrete: the Node sidecar fetch is Windows-only, `node-pty` lacks Linux prebuilds in this dependency tree, the bundle targets are NSIS-only, and the release workflow runs only on `windows-latest`. Treat this phase as gated: it starts when the harness's own Linux support is complete enough that the desktop shell is the only remaining gap, not before.

### Phase 7: dormant-capability payload decision

The baked runtime carries roughly 60 MB of intentionally mounted, default-disabled capability. Decide whether the desktop payload ships it, and record the decision with its reason either way; the [size analysis](../../../../apps/desktop/docs/size-analysis.md) holds the measurements. This is a product decision, so an agent does not settle it alone.

Decision (2026-08-22, product): **keep**. The dormant bytes are the legitimate product surface of optional multi-provider and opt-in telemetry capability, default-inactive; cutting them would ship a DeepSeek-only desktop edition with a new bundle profile and maintenance cost. Recorded in the size analysis.

### Environment facts an agent should not rediscover

- A packaged desktop installation runs its own baked runtime from its install directory. When it is the live GUI, repository build outputs are not locked by it, and `pnpm run build` is safe. Measure before assuming either way.
- `scripts/ci-workflow.spec.ts` fails here because this fork carries no inherited workflow. [The divergence register](../../../../docs/fork-divergence.md) records it as expected; never silence it by restoring upstream automation.
- Re-entering pnpm goes through `scripts/package-manager.ts`; a standalone pnpm install exposes a native `npm_execpath` ([note](../../implemented/bug-fix/2026-08-21-nested-pnpm-native-entrypoint.md)).
- `createUpdaterArtifacts` is enabled, so a local `tauri build` fails without a signing key. The tag-gated workflow holds the real key; use its published installer for smokes instead of reproducing signing locally.
- Recording GUI evidence follows [record-browser-gif](../../../skills/record-browser-gif/SKILL.md). Its encoder needs both `ffmpeg` and `ffprobe`, and a Playwright release may not match the browser revision present on the machine, so pass an explicit `executablePath` rather than installing another browser.
- A version bump is one edit in `apps/desktop/package.json`; `pnpm --filter @deepseek-ai/dsh-desktop version-check` asserts the propagated sources agree.

### Standing constraints for every phase

Desktop UI and Host integration stay under `apps/desktop`. A change to an upstream-owned path needs an independent harness need and a reasoned row in [the divergence register](../../../../docs/fork-divergence.md). Every product-visible change carries focused unit tests, Host integration evidence, and a GIF recorded from the real application; a capability seam ships its Service Definition, Provider, Consumer, and lifecycle tests together.

## Alternatives considered

- **Put this plan in the desktop README.** Rejected because the README states current capability for users, and a phase plan with rationale and acceptance criteria is what an Agent Note is for. The README's roadmap list stays the short user-facing view.
- **Extend the 0.3 proposal to cover later phases.** Rejected because that note's status tracks one release whose tail is still open; folding future phases in would keep it proposed indefinitely and blur what remains for 0.3.
- **Order by user value, taking Source Control writes first.** Rejected because every product phase needs GUI evidence, and producing it without Phase 2 repeats the same manual setup per phase while making each recording harder to reproduce.
- **Include Git worktree checkout management with Phase 3.** Rejected on the 0.3 proposal's existing grounds: creating and switching checkouts is destructive project mutation needing branch, dirty-state, collision, and cleanup policy that whole-file staging does not.
- **Add file editing with Phase 4.** Rejected because a viewer is complete and useful on its own, while editing needs conflict, encoding, and undo policy that would delay it.
- **Ship a Linux build as soon as it compiles.** Rejected because a build that cannot open a terminal session is not a usable edition; the `node-pty` and sidecar gaps decide the phase, not the Rust target.

## Acceptance criteria

- Phase 2 ends with one documented command that prints a serving URL whose `/dsh-bridge/config` answers and whose Worktree panel mounts in a browser, and with `operating-constraints.md` describing how to measure the live runtime instead of asserting one topology.
- Phase 3 ends with staging, unstaging, discarding, committing, and diff viewing confined to the selected Workspace, each destructive action confirmed by name, unclassified entries offered no mutation, and cancellation and reconnect covered.
- Phase 4 ends with a read-only viewer that bounds bytes, states truncation, refuses binary and non-UTF-8 content, and scrolls a Search result to its matched line.
- Phase 5 ends with snap layout, resize borders, and maximize state driven by window state, and with a loopback token whose absence preserves today's behavior.
- Phase 6 ends with an installable second-platform artifact that reaches the readiness line and opens a terminal session, produced by the same tag-gated workflow.
- Phase 7 ends with a recorded decision and its reason, and a payload measurement that matches it.
- Every phase leaves `pnpm run doc-sync` green, the bilingual pairs recorded, and its product-visible behavior demonstrated by a GIF from the real application.

## Risks

Phase 2 is infrastructure whose value is indirect, so it is the phase most likely to be skipped under time pressure; skipping it moves its cost into every later phase rather than removing it. Phase 3 introduces the first destructive Git operations in the desktop client, where a wrong path or a stale status turns a mistake into lost work — the confirmation text and the refusal to mutate unclassified entries are release requirements, not polish. Phase 5's loopback token touches an upstream-owned server and can regress the plain browser posture if the unconfigured path is not preserved exactly. Phase 6 is the largest and the easiest to start too early; a half-supported platform costs more in issues than it returns. Phase 7 may be deferred indefinitely without harm, which is itself a risk: the reserved payload keeps being paid for by every download until the decision is recorded.
