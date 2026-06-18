import { BrowserWindow, shell, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** Resolve the app icon path, with a fallback for dev where `build/` may not exist. */
function resolveIconPath(): string | undefined {
  // In production (packaged asar), icons are inside the asar at build/.
  // In dev, they're relative to the project root.
  // We also check process.resourcesPath for electron-builder extraResources.
  const candidates = [
    join(__dirname, '../../build/icon-256.png'),
    join(__dirname, '../../build/icon.png'),
    join(__dirname, '../build/icon-256.png'),
    join(process.resourcesPath || '', 'build/icon-256.png'),
    join(process.resourcesPath || '', 'icon-256.png'),
  ]
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return p
    } catch { /* skip */ }
  }
  return undefined
}

export function createMainWindow(): BrowserWindow {
  const iconPath = resolveIconPath()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    title: 'EasyPrompt',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Hide-to-tray instead of quitting on close (production only).
  // In dev mode, actually close so the process can be restarted cleanly.
  mainWindow.on('close', (e) => {
    if (is.dev) return // let the window close normally
    // If window is already hidden, this is a force-close (installer / shutdown).
    // Allow the window to actually close so the process can exit cleanly.
    if (!mainWindow?.isVisible()) return
    e.preventDefault()
    mainWindow?.hide()
  })

  // Open external links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // DIAGNOSTIC: forward renderer console + load failures to main stdout so
  // white-screen issues are visible. (Safe to keep permanently.)
  mainWindow.webContents.on('console-message', (_e, _level, message) => {
    console.log(`[renderer] ${message}`)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[did-fail-load] ${code} ${desc} — ${url}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details)
  })

  // HMR for dev, bundled file for prod.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/** Show & focus the main window (used by global shortcut & tray). */
export function revealMainWindow(): void {
  const win = mainWindow
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

/** Toggle main window visibility: hide if visible & focused, show otherwise. */
export function toggleMainWindow(): void {
  const win = mainWindow
  if (!win) return
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  }
}
