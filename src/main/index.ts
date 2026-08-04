import { app, BrowserWindow, Menu } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { optimizer, is } from '@electron-toolkit/utils'
import { createMainWindow, getMainWindow, revealMainWindow, markForceQuitting, isForceQuitting } from './window'
import { createTray, destroyTray } from './tray'
import { registerShortcut, unregisterAll } from './shortcut'
import { registerIpc } from './ipc'
import { getConfigInternal } from './config/store'
import { defaultShortcut } from '@shared/types'

/** Replace literal space chars with "Space" for Electron accelerator compatibility. */
function normalizeAccel(accel: string): string {
  return accel.replace(/ \+ $/, '+Space').replace(/^ $/, 'Space')
}

// In dev mode, use a project-local data directory so:
//   1. TCC-restricted ~/Library/Application Support/<app> files from a
//      previous run can't block the single-instance lock.
//   2. Dev runs never interfere with production user data.
// MUST be called before app.requestSingleInstanceLock() / app.whenReady().
if (is.dev) {
  const devData = path.join(process.cwd(), '.dev-data')
  app.setPath('userData', devData)
  app.setPath('sessionData', devData)
}

// Single-instance lock — second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // In dev mode, stale lock files from a crashed previous run can cause
  // requestSingleInstanceLock() to fail. Instead of silently quitting with
  // no visible output, log a clear diagnostic and force-exit.
  if (is.dev) {
    console.error(
      '[EasyPrompt] Could not acquire single-instance lock. ' +
        'A previous instance may still be running (or stale lock files exist). ' +
        'Kill any EasyPrompt/Electron processes and delete ' +
        `${app.getPath('userData')}/SingletonLock if it persists, then retry.`
    )
    process.exit(1)
  }
  app.quit()
} else {
  app.on('second-instance', () => revealMainWindow())
  bootstrap()
}

function bootstrap(): void {
  // MUST be called before app.whenReady() on Windows.
  // If set after the ready event, Windows may already have associated the process
  // with the default AppUserModelId, causing the taskbar to show Electron's
  // default icon instead of the custom one (race condition — works on some
  // machines, fails on others).
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.easyprompt.app')
  }

  app.whenReady().then(async () => {

    // Enforce a Content-Security-Policy only in production. In dev, Vite injects
    // inline + eval HMR scripts that a strict CSP would block (white screen).
    if (!is.dev) {
      const { session } = await import('electron')
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:"
            ]
          }
        })
      })
    }

    app.on('browser-window-created', (_e, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Ensure the workspace folder exists before any FS IPC fires.
    await ensureWorkspace()

    registerIpc()
    createMainWindow()

    const cfg = await getConfigInternal()
    createTray(cfg.app.language)

    // Normalize stored shortcut (defense against legacy "Shift+ " bug)
    // and fall back to platform-appropriate defaults if registration fails.
    const shortcut = normalizeAccel(cfg.app.shortcut || defaultShortcut(process.platform))
    if (!registerShortcut(shortcut)) {
      // Shift+P is unlikely to conflict with system shortcuts on any platform.
      // Try fallback accelerators in order of preference.
      const fallbacks =
        process.platform === 'win32'
          ? ['Alt+Space', 'Ctrl+Shift+P', defaultShortcut(process.platform)]
          : [defaultShortcut(process.platform)]
      let registered = false
      for (const fb of fallbacks) {
        if (fb === shortcut) continue // already tried
        console.warn(`[EasyPrompt] Shortcut "${shortcut}" failed — trying "${fb}"`)
        if (registerShortcut(fb)) {
          registered = true
          break
        }
      }
      if (!registered) {
        console.error('[EasyPrompt] All shortcut fallbacks exhausted. Global summon shortcut is unavailable.')
      }
    }

    applyAppMenu()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      else revealMainWindow()
    })
  })

  // On macOS keep running (tray) in production. On Windows, if the window was
  // actually destroyed (not just hidden), quit the process so installers can proceed.
  app.on('window-all-closed', () => {
    if (is.dev) {
      app.quit()
      return
    }
    // Non-macOS: always quit when the last window closes.
    if (process.platform !== 'darwin') {
      app.quit()
      return
    }
    // macOS production: quit only when the user explicitly chose to quit
    // (dock Quit, Cmd+Q, tray Quit). Otherwise stay alive with the tray.
    if (isForceQuitting()) {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    markForceQuitting()
    unregisterAll()
    destroyTray()
  })
}

/** Create the configured workspace dir if missing. Skips if unset (fresh install). */
async function ensureWorkspace(): Promise<void> {
  const config = await getConfigInternal()
  const ws = config.app.workspace
  if (!ws) return // User hasn't picked a workspace yet — don't create anything.
  try {
    await fs.mkdir(ws, { recursive: true })
  } catch (err) {
    console.error('[EasyPrompt] Failed to create workspace:', err)
  }
}

/**
 * Application menu.
 *
 * CRITICAL: an Edit submenu with the standard roles MUST be present on macOS.
 * There, copy/cut/paste/selectAll/undo/redo are not delivered to webContents
 * by the OS — they are routed through the Edit menu roles. A menu with no Edit
 * submenu (or setApplicationMenu(null)) means Cmd+C/V/X/A silently do nothing
 * in EVERY input/textarea (the Settings API-key field included). On Win/Linux
 * these are handled by the renderer, but the roles are harmless there too.
 *
 * `autoHideMenuBar: true` (see createMainWindow) keeps the bar invisible on
 * Win/Linux, so this only surfaces via accelerators / the macOS menu bar.
 */
function applyAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'EasyPrompt',
      submenu: [
        ...(process.platform === 'darwin' ? [{ role: 'about' } as Electron.MenuItemConstructorOptions] : []),
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ]

  if (is.dev) {
    template.push({
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export { getMainWindow }
