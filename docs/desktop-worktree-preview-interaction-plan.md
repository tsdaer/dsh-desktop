# Desktop Worktree Preview and Interaction Development Plan

English | [中文](desktop-worktree-preview-interaction-plan.zh.md)

Status: proposed

## Summary

This plan guides an implementation agent through four related desktop improvements: unambiguous Worktree path insertion, themed Explorer entry icons, a dedicated read-only text preview window, and reliable context-menu and external-link behavior. It preserves the Host-owned Workspace containment and bounded file-reading rules that the desktop bridge already enforces. The work is split into reviewable slices with explicit source ownership, failure behavior, tests, and GUI evidence. The phrase “non-binary files do not need to open” in the request is treated as “binary files do not open”; implementation must confirm this interpretation before the preview slice begins.

## Table of Contents

- [Current baseline](#current-baseline)
- [Required behavior](#required-behavior)
- [Architecture and ownership](#architecture-and-ownership)
- [Delivery plan](#delivery-plan)
- [Verification matrix](#verification-matrix)
- [Acceptance criteria](#acceptance-criteria)
- [Risks and decisions](#risks-and-decisions)
- [Agent handoff checklist](#agent-handoff-checklist)
- [Dev Note](#dev-note)

-----

<a id="current-baseline"></a>

## Current baseline

The implementation agent must verify these facts again against its checkout before editing. They describe the inspected branch on 2026-08-29 and are not substitutes for reading the owning files.

- `apps/desktop/bridge-client/src/client/DesktopWorkspacePathDrop.ts` validates a Workspace-relative path and formats it as `./<path>` before composer insertion.
- `apps/desktop/bridge-client/src/client/DesktopWorkspaceExplorer.tsx` renders `▸` or `▾` for directories and `·` for files, and opens files in an Explorer-local `DesktopWorkspaceFileViewer` overlay.
- `apps/desktop/bridge/src/file.ts` already resolves a registered Workspace and relative path through the Host, rejects escapes and non-regular targets, enforces a byte limit, rejects NUL-containing or invalid UTF-8 content as `binary-file`, and reports truncation.
- `apps/desktop/bridge-client/src/client/DesktopContextMenu.ts`, `DesktopContextMenuPortal.ts`, and `index.ts` implement target classification, clipboard actions, a body portal, and global open/close listeners, but their tests do not yet cover all pointer, focus, selection, contenteditable, navigation, and clipboard-failure cases.
- Shared chat Markdown creates sanitized HTTP(S) anchors with `target="_blank"`, but the desktop shell does not own a complete click-to-native-opener path for those anchors.

The existing implemented decisions remain authoritative: [Desktop Worktree Explorer](../.agents/notes/implemented/feature/2026-08-19-desktop-worktree-explorer.md) owns Workspace-relative listing and drag safety, and [Desktop in-app file viewer](../.agents/notes/implemented/feature/2026-08-22-desktop-file-viewer.md) owns bounded text reads and binary refusal. The implementation must update or supersede those Agent Notes instead of silently contradicting them.

-----

<a id="required-behavior"></a>

## Required behavior

### Path insertion

Dragging an in-root Worktree file or directory into the composer inserts its normalized Workspace-root-relative path without a leading `./`, for example `apps/desktop/README.md`. The browser continues to reject absolute paths, drive-relative paths, backslashes, empty paths, `.` segments that normalize to empty, and `..` escapes. An operating-system file or directory drop remains a real absolute filesystem path because it may be outside every registered Workspace; the change must not pass an external drop through the Worktree formatter.

The composer keeps its existing caret placement, undo semantics, multiline insertion, and drag focus ring. Tests and documentation must use the terms “Workspace-relative path” and “external filesystem path” consistently so an agent can infer which root applies.

### Explorer entry icons

Every directory row uses one folder glyph whose visual state changes between closed and open. Every regular file row uses a file glyph rather than punctuation. Outside-root or unsupported entries retain a distinct warning glyph and must not resemble an openable file.

Icons must come from the repository-owned shared icon system when a matching glyph exists. If the icon set lacks folder-open, folder-closed, file, or warning glyphs, add theme-neutral SVG glyphs to the owning primitive package and consume them from the desktop bridge client; do not paste independent inline SVG copies into each row. Use `currentColor` for strokes and fills, preserve a fixed layout box to avoid row movement, expose state through `aria-expanded` and accessible row labels rather than icon-only labels, and verify light, dark, hover, selected, disabled, high-contrast, and Git-decoration combinations.

### Dedicated file preview window

Activating an in-root regular file from Explorer or Search opens or focuses a dedicated Tauri Webview window instead of inserting an overlay in the Worktree pane. A window is keyed by Workspace id plus normalized relative path so repeated activation does not create uncontrolled duplicates. The title contains the file name; the body shows the Workspace-relative path, truncation or refusal state, copy action, and read-only rendered content. Closing the preview never closes the main window or changes the active Session.

The preview window requests content only through the existing authenticated desktop bridge file route. The Host remains responsible for canonical-root containment, file type checks, byte limits, cancellation, binary detection, strict UTF-8 decoding, and stable errors. Window labels, query fields, and events carry only a Workspace id and normalized relative path; they never carry an unrestricted absolute path, raw HTML, bearer token in logs, or user-controlled shell command.

Markdown-family files render as Markdown. Other recognized text and programming-language files are converted to a generated Markdown fenced code block with a language hint derived from the extension. The wrapper must choose a fence longer than any matching delimiter run in the source so file content cannot terminate the generated block. Unknown text uses a plain-text fence. Binary or invalid UTF-8 files do not open a content renderer; the initiating view shows a localized refusal message, or a newly created preview window shows the same stable refusal and then remains safe to close. The implementation must choose one behavior and pin it in tests before coding the window lifecycle.

Evaluate Vditor as a static renderer, not as an editor. Its documented `Vditor.preview(element, markdown, options)` API supports static Markdown, code highlighting, line numbers, sanitization, and light/dark modes; the project documentation also exposes `preview.markdown.sanitize`, `preview.hljs`, and theme controls ([Vditor repository and API](https://github.com/Vanessa219/vditor), [preview options](https://ld246.com/article/1549638745630#options-preview-markdown)). If adopted, bundle an exact dependency version and all required CSS/assets with the desktop application, configure a local asset base instead of the default public CDN, keep sanitization enabled, disable editing, cache, uploads, speech, media embeds, and unnecessary diagram engines, destroy the renderer on window teardown, and route rendered links through the desktop link policy. Do not introduce network-dependent preview behavior.

Before adding Vditor, compare it with the existing `MarkdownText` and Shiki primitives for bundle size, offline completeness, theme fidelity, CSP requirements, sanitization, relative image behavior, line-number support, and maintenance cost. Record the decision in the feature Agent Note. If the existing renderer satisfies the acceptance criteria with less owned code and no semantics loss, prefer it; the user proposed Vditor as an available option, not a mandatory dependency.

### Context menu and links

Treat the context menu as one explicit state machine with at most one active menu. Opening a second menu closes the first. Action, Escape, outside pointer press, wheel or scroll, resize, visual-viewport resize, blur, route or Session navigation, and plugin disposal close it exactly once and restore focus when appropriate. A right-click inside the menu does not recursively replace it. Positioning uses the visual viewport, accounts for menu size after mount, and flips or clamps at all four edges.

Target classification must distinguish the composer, ordinary editable controls, password or sensitive controls, a readable selection, links, and non-actionable content. Composer cut, copy, and paste must use the current Lexical/contenteditable integration rather than assume a textarea. Disabled or read-only controls cannot mutate. Clipboard rejection leaves content unchanged and produces a localized, non-blocking failure indication. Keyboard navigation supports Up, Down, Home, End, Enter, Space, Tab policy, and Escape without trapping focus after closure.

The desktop bridge client owns delegated clicks on safe `http:` and `https:` anchors in chat and preview content. It prevents WebView navigation, validates the parsed URL and protocol again, and calls a narrow Tauri command backed by the platform opener. Reject `javascript:`, `data:`, `file:`, credential-bearing URLs, malformed URLs, and internal bridge URLs. The opener command accepts only a validated URL string, has an explicit Tauri capability entry, returns typed failure, and never invokes a shell. Modified clicks and keyboard activation follow one documented policy; tests must prevent duplicate opening from both anchor defaults and delegated handling.

-----

<a id="architecture-and-ownership"></a>

## Architecture and ownership

Keep the change inside desktop plugins unless a reusable icon or renderer correction belongs to `packages/client/ui-primitives`. Do not patch `agent-loop`, session events, Workspace persistence, or unrestricted filesystem APIs.

| Concern | Primary owner | Expected change |
|---|---|---|
| Worktree path text | `apps/desktop/bridge-client/src/client/DesktopWorkspacePathDrop.ts` | Return normalized relative text without `./`; retain rejection rules. |
| Composer drop lifecycle | `apps/desktop/bridge-client/src/client/index.ts` and `DesktopComposerPaste.ts` | Preserve internal versus OS-drop separation, focus ring, caret, and undo. |
| Entry glyphs | `DesktopWorkspaceExplorer.tsx`, its CSS module, and optionally `packages/client/ui-primitives` | Replace punctuation with shared stateful icons and themed styling. |
| File bytes and errors | `apps/desktop/bridge/src/file.ts` | Reuse the route; change only if window lifecycle reveals a missing bounded response field. |
| Preview orchestration | New bridge-client preview controller and preview-window entry component | Validate requests, deduplicate windows, synchronize theme and locale, cancel reads, and clean up. |
| Native window and URL opening | `apps/desktop/src-tauri/src/` plus Tauri capabilities | Create or focus constrained preview windows and open allowlisted external URLs without a shell. |
| Context menu | `DesktopContextMenu.ts`, `DesktopContextMenuPortal.ts`, and `index.ts` | Centralize state, classification, focus, positioning, closure, and failures. |
| Product copy | `apps/desktop/bridge-client/src/client/locales.ts` | Add typed English and Chinese labels; no hardcoded client UI copy. |
| Durable rationale | Existing or new `.agents/notes/` bilingual note | Record renderer, window identity, opener security, and rejected alternatives. |

The preview window should load a dedicated local frontend entry or an explicit application route with minimal dependencies. It must not mount the complete chat application merely to display one file. The shell creates it with a stable label, conservative initial size, minimum size, normal OS decorations unless the product has a shared window-chrome component, and the same origin and authentication setup as the main window. Define behavior for main-window exit, application exit, update restart, Workspace removal, locale changes, theme changes, duplicate open requests, load failure, and a file changed between clicks.

Theme and locale synchronization must use existing desktop or client-runtime signals where possible. A preview window opened after a change reads the current values at startup; an already open window updates without reload. The implementation must not infer theme from arbitrary colors or duplicate locale dictionaries inside Tauri Rust.

-----

<a id="delivery-plan"></a>

## Delivery plan

### Phase 0 — Reproduce and freeze the baseline

1. Run the focused desktop bridge-client and Host tests that cover Explorer drag formatting, Explorer rendering, file viewing, composer insertion, and context menus.
2. Use the real desktop evidence server to reproduce the `./` insertion, punctuation icons, page-local viewer, each reported context-menu defect, and inactive chat links. Record exact steps, expected behavior, actual behavior, platform, WebView version, and screenshots before changing code.
3. Inspect the active composer DOM and selection API. Update the plan if it is Lexical/contenteditable rather than the textarea assumptions still present in context-menu helpers.
4. Measure the current desktop bundle, then prototype both Vditor static preview and the existing Markdown primitive against representative Markdown, TypeScript, JSON, a long file, an invalid UTF-8 file, relative images, unsafe HTML, and external links.
5. Confirm the request ambiguity: the plan assumes text opens and binary does not. Stop the preview slice if the intended rule differs.

### Phase 1 — Path text and Explorer icons

1. Change the Worktree formatter to return only the normalized relative path and rename helpers or tests that encode the old `./` presentation.
2. Keep the internal pointer event payload as a validated relative path; format only at the composer insertion edge so future consumers cannot confuse transfer data with presentation text.
3. Add or reuse folder-closed, folder-open, file, and warning icons. Keep one icon box and use `currentColor` plus state classes or attributes.
4. Update Explorer rendered tests for icon state, `aria-expanded`, keyboard activation, warning entries, theme classes, and coexistence with Git decorations.
5. Update desktop README and changelog pairs only when behavior ships; re-record bilingual pairing.

### Phase 2 — Preview renderer and dedicated window

1. Write a short Agent Note amendment or superseding proposal that selects Vditor static preview or the existing renderer using the Phase 0 evidence.
2. Extract a pure preview projection function: path extension to content mode and language, Markdown passthrough, collision-safe code-fence wrapping, title derivation, and binary or truncation presentation.
3. Add a typed preview-open request in the browser-to-shell integration. Validate Workspace id and relative path in the browser for early feedback and again in the Host route for authority.
4. Add a Tauri window controller that derives a non-sensitive deterministic window label, focuses an existing matching window, creates a missing window, and releases registry state on destruction or creation failure.
5. Mount the minimal preview component, fetch through `bridgeFetch`, cancel on path change or teardown, ignore stale responses, synchronize locale and theme, render loading, empty, truncated, binary, permission, missing, and generic failure states, and expose copy and close controls.
6. Remove the Explorer-local viewer overlay only after Explorer and Search both use the window controller. Delete dead state, CSS, and tests rather than retaining two preview paths.
7. Add dependency packaging, licenses, CSP or capability changes, and offline asset verification if Vditor is selected. Run a packaged smoke with networking disabled.

### Phase 3 — External links

1. Add one URL parser and policy that accepts only absolute HTTP(S) URLs without embedded credentials. Use it in chat and preview delegated-click handling and at the Rust command entry.
2. Add the narrow native opener command and explicit capability grants for the main and preview windows. Use an opener API or process-safe library, never command-string construction.
3. Intercept safe anchor activation before WebView navigation. Define primary click, Enter, Ctrl or Command click, Shift click, and middle click behavior and prevent duplicate opens.
4. Render localized failure feedback when the OS opener rejects a valid URL. Do not navigate the app window as fallback.
5. Test links produced by ordinary Markdown, inline-code URL conversion, tool-result cards, Vditor or the selected preview renderer, and unsafe-scheme plain text.

### Phase 4 — Context-menu repair

1. Convert menu lifecycle and closure causes into a testable controller rather than unrelated document listeners with shared mutable globals.
2. Update target classification for the actual composer DOM, nested elements, contenteditable selection, ordinary inputs, read-only and disabled controls, password fields, links, selected chat text, and the menu portal itself.
3. Route composer mutations through the composer-owned paste or command API. Preserve selection, focus, undo, input events, and IME composition; do not write stale DOM text directly.
4. Make clipboard operations report success or typed failure. Add localized non-blocking feedback and ensure cut removes text only after clipboard write succeeds.
5. Use measured menu dimensions and the visual viewport for placement. Add full keyboard navigation and deterministic focus restoration.
6. Add tests for every closure cause, repeated open or close, event-listener cleanup, clipboard rejection, empty selection, selection outside the click target, scrolling containers, zoomed viewport, and interaction with delegated links.

### Phase 5 — Integration and evidence

1. Run focused unit, rendered client, Host bridge, Rust, packaged, i18n, documentation, and link checks selected by the outgoing diff.
2. Run the real desktop application on Windows and at least one POSIX target when the window or opener code is platform-specific. Verify light and dark themes, keyboard-only operation, high DPI, long paths, non-ASCII names, multiple preview windows, and offline startup.
3. Because the change is product-user-visible GUI behavior, record the required GIF from the pull request's real server and model flow with the repository `record-browser-gif` workflow. Show Worktree drag insertion, folder state icons, text preview, binary refusal, context menu, and chat-link opening without exposing private paths or credentials.
4. Update the affected desktop README and changelog bilingual pairs, owning JSDoc, active Agent Notes, and any fork-divergence row required by changes to upstream-owned paths.
5. Apply `dsh-pre-push-checks` before publishing the branch. Report only commands actually run and do not claim platform evidence that was skipped.

-----

<a id="verification-matrix"></a>

## Verification matrix

| Area | Unit or pure tests | Rendered or integration tests | Native or packaged evidence |
|---|---|---|---|
| Worktree path | normalization, rejection, no `./` prefix | internal drag to composer, multiline insertion, caret and undo | real Worktree file and directory drops; external absolute drop unchanged |
| Explorer icons | icon selection from type and expanded state | accessible names, keyboard toggle, theme and Git decorations | light, dark, high DPI, hover and selected screenshots |
| File route | containment, limits, cancellation, binary and UTF-8 rejection | typed response parsing and stale-request suppression | packaged read from registered Workspace only |
| Preview projection | extension mapping, Markdown passthrough, collision-safe fences | Markdown and code rendering, truncation, unsafe HTML and links | offline packaged window, duplicate focus, locale and theme updates |
| Window lifecycle | deterministic non-sensitive identity | open, focus, close, failure cleanup, Workspace switch | Windows plus one POSIX target; app exit and update restart |
| Link opening | URL allowlist and credential rejection | click and keyboard delegation, no duplicate navigation | default browser receives HTTP(S); unsafe schemes do nothing |
| Context menu | classification, action enablement, clipboard failure | focus, viewport placement, keyboard, closure, cleanup, Lexical integration | real chat, composer, settings, selection, and zoomed-window use |
| Localization and accessibility | dictionary completeness | roles, names, focus order, contrast | screen-reader spot check and keyboard-only GIF segment |

Run the smallest commands that own these files. At minimum, expect focused Vitest commands for `apps/desktop/tests/` and `apps/desktop/bridge-client/tests/`, the desktop bridge build, focused Cargo tests for new Tauri modules, `pnpm run verify-client-ui-i18n`, bilingual pairing checks, `pnpm run test:docs`, `pnpm run doc-sync`, `git diff --check`, and target-specific packaged smoke. The implementation agent must derive exact filters from the final diff and the repository pre-push skill.

-----

<a id="acceptance-criteria"></a>

## Acceptance criteria

1. A Worktree entry dropped into the composer produces `path/from/workspace/root.ext`, never `./path/from/workspace/root.ext`; OS drops continue to produce real external paths.
2. Directories show stable closed and open folder icons, files show a file icon, warning entries remain distinct, and all glyphs respond to theme color without layout shift.
3. Explorer and Search file activation opens or focuses a separate preview window. Markdown renders as Markdown; supported source files render as highlighted code; unknown text renders safely; truncation is visible; binary and invalid UTF-8 content never reaches the renderer.
4. Preview reads remain bounded, authenticated, Workspace-contained, cancellable, and free of arbitrary absolute-path or shell input. Preview works from packaged assets while offline.
5. Safe chat and preview HTTP(S) links open in the operating system browser exactly once. Unsafe, malformed, credential-bearing, local-file, and bridge URLs do not open.
6. The custom context menu works for the actual composer and readable chat selections, never mutates disabled, read-only, or sensitive controls, remains within the visual viewport, supports keyboard operation, handles clipboard failure, and cleans up every listener and portal.
7. English and Chinese UI strings, README or changelog updates, Agent Notes, tests, packaged smokes, screenshots, and the required GUI GIF agree with shipped behavior.

-----

<a id="risks-and-decisions"></a>

## Risks and decisions

- **Request ambiguity:** “non-binary files do not need to open” conflicts with the requested Markdown and source preview. This plan assumes it means “binary files do not open.” Confirm before Phase 2.
- **Vditor asset loading:** Vditor defaults can load resources from a public CDN and enable more rendering features than required. Any adoption must self-host assets, disable unused features, and pass an offline packaged smoke.
- **Duplicate Markdown stacks:** Adding Vditor beside the shared Markdown renderer increases bundle size and creates two sanitization and theme policies. The Phase 0 comparison is a merge prerequisite.
- **Untrusted content:** Markdown, file text, and URLs are untrusted. Sanitization stays enabled, raw HTML and active content remain blocked, and external links pass through one native allowlist.
- **Window identity and privacy:** Raw paths in Tauri labels, telemetry, or logs can expose project names. Derive a non-sensitive identity and keep display paths inside window content only.
- **Composer drift:** Existing context-menu helpers still contain textarea assumptions while the composer uses Lexical/contenteditable behavior. Mutations must use the current composer-owned integration.
- **Relative Markdown assets:** A Markdown file can reference relative images or links. The first release should leave unresolved local assets blocked unless a separate bounded asset route, MIME allowlist, containment rule, and CSP policy are designed and accepted.
- **Binary preflight:** Creating a window before the Host reports `binary-file` can cause a brief empty window. Choose and test either preflight-before-create or an explicit refusal state; do not add an unrestricted file-type probe.

-----

<a id="agent-handoff-checklist"></a>

## Agent handoff checklist

The implementation agent must complete this list in order and keep the pull request reviewable.

1. Read root `AGENTS.md`, `apps/desktop/README.md`, desktop package manifests, `docs/architecture.md`, `docs/defensive-patterns.md`, the two owning Agent Notes linked above, and every more-specific instruction file before editing.
2. Inspect `git status` and preserve unrelated user changes. Record the current branch and base.
3. Reproduce each defect and attach evidence to the task or pull request. Convert vague context-menu reports into named failing scenarios.
4. Add or update the proposed feature Agent Note before making non-trivial architecture choices. Keep English, Chinese, and pairing sidecar synchronized.
5. Implement Phases 1 through 4 as separate commits or stacked pull requests when they can pass independently. Fix an introducing branch before propagating changes upward.
6. Do not add compatibility behavior for the old `./` formatting; update every reference because the repository is pre-release.
7. Keep model-visible behavior unchanged. These UI changes do not create Session events or change agent-loop behavior.
8. Run the verification matrix, inspect the complete diff twice for correctness and unnecessary prose, and use the pre-push skill before publishing.
9. Record the real GUI GIF after the final UI and real server flow are stable, then verify the packaged build without network access.
10. On completion, rewrite the owning proposed Agent Note into shipped present-tense decisions or supersede the older implemented notes, and remove resolved planning residue from durable current-state documentation.

-----

<a id="dev-note"></a>

## Dev Note

<details>
<summary>Active working context</summary>

Owner: desktop maintainers. Created: 2026-08-29. Review or promote by: 2026-09-29. Promotion target: the relevant desktop feature and bug-fix Agent Notes plus current-state desktop README sections. Delete this plan after its acceptance criteria and durable decisions have moved to their owners.

</details>
