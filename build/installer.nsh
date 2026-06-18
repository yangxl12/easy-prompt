; ═══════════════════════════════════════════════════════════════════════════════
; EasyPrompt — NSIS custom installer script
; ═══════════════════════════════════════════════════════════════════════════════
;
; This file is auto-detected by electron-builder (default: build/installer.nsh)
; and injected into the generated NSIS installer via `!include installer.nsh` in
; installSection.nsh.
;
; It overrides three critical behaviours:
;
;   1. customCheckAppRunning — replaces the default process-check macro.
;      The default asks the user to close the app and blocks if kill fails.
;      Ours silently taskkill /f once, then proceeds regardless.
;
;   2. customInit — runs during .onInit, BEFORE the install section.
;      Cleans stale registry keys left by a previous broken / partial install,
;      so that uninstallOldVersion won't find a corrupted uninstaller and loop
;      forever showing "app cannot be closed".
;
;   3. customUnInstallCheck / customUnInstallCheckCurrentUser — safety nets
;      that swallow uninstall errors instead of blocking the installer.
;
; Stack discipline:
;   Every nsExec::Exec MUST be followed by Pop $R9 (or equivalent) because
;   nsExec::Exec pushes the child-process exit code onto the NSIS stack.
;   Leaking it corrupts the stack for subsequent Push/Call/Exch sequences.
;
; Compile-time include order:
;   This file is injected by electron-builder into the SHARED HEADER
;   (computeCommonInstallerScriptHeader), which is prepended to the original
;   installer.nsi template for BOTH the installer and uninstaller builds.
;   Our script is therefore processed FIRST, before allowOnlyOneInstallerInstance.nsh.
;
;   Because we define customCheckAppRunning, allowOnlyOneInstallerInstance.nsh
;   will skip its own "Var pid" and "!include getProcessInfo.nsh" (guarded by
;   !ifmacrondef customCheckAppRunning).  So WE must declare Var pid and
;   include nsProcess.nsh here.  getProcessInfo.nsh already has a !ifndef guard.
; ═══════════════════════════════════════════════════════════════════════════════

!include "getProcessInfo.nsh"
!include "nsProcess.nsh"
Var pid

; ── 1. Non-blocking process check ──────────────────────────────────────────

!macro customCheckAppRunning
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      DetailPrint `"${PRODUCT_NAME}" is running — force closing...`
      !ifdef INSTALL_MODE_PER_ALL_USERS
        nsExec::Exec `taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid"`
        Pop $R9  ; discard exit code — keep stack balanced
      !else
        nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
        Pop $R9  ; discard exit code — keep stack balanced
      !endif
      Sleep 1500
      DetailPrint `Proceeding with installation.`
    ${endif}
  ${endif}
!macroend

; ── 2. Clean stale registry before uninstall attempt ──────────────────────
;
; This runs in .onInit AFTER initMultiUser has already detected the previous
; install mode (per-user / per-machine) and set SetShellVarContext, so
; SHELL_CONTEXT resolves correctly.  The variables $hasPerMachineInstallation
; and $hasPerUserInstallation are already set — deleting the registry keys
; does NOT affect the install-mode decision for this run.
;
; DeleteRegKey is silent when the key does not exist, so it's safe to
; unconditionally delete all possible locations.  We start with ClearErrors
; to ensure stale error flags from earlier init steps don't leak through.

!macro customInit
  ClearErrors
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
  ClearErrors
!macroend

; ── 3. Safety nets: ignore uninstall errors ────────────────────────────────
;
; handleUninstallResult normally checks $R0 (uninstaller exit code) and shows
; an error dialog if non-zero.  By defining customUnInstallCheck, we intercept
; before that check and return early — any uninstall failure is silently
; accepted so the new installation can proceed.

!macro customUnInstallCheck
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  ClearErrors
!macroend
