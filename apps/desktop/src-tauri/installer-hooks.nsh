; NSIS hooks for the dsh-desktop installer, wired through
; `bundle.windows.nsis.installerHooks` in tauri.conf.json.
;
; The application registers its Explorer "以 dsh-desktop 打开" entries itself on
; every start (`ensure_explorer_context_menu` in src/main.rs), so the Tauri
; uninstaller has no record of them and leaves them behind pointing at a
; deleted executable. `installMode` stays at its `currentUser` default, so the
; uninstaller runs unelevated as the installing user and HKCU is that user's
; hive.
;
; An update reinstall also runs the uninstaller: the entries are removed here
; and re-registered by the next launch, so this removal is self-healing.
; $DSH_HOME is user data and is never touched.

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\dsh-desktop"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\dsh-desktop"
!macroend
