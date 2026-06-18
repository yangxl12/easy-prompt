import { globalShortcut } from 'electron'
import { getMainWindow } from './window'

/**
 * Register the global summon shortcut. Returns success.
 * The shortcut toggles window visibility: press once to show, press again to hide.
 * Electron rejects accelerators already claimed by another app.
 */
export function registerShortcut(accelerator: string): boolean {
  unregisterAll()
  const ok = globalShortcut.register(accelerator, () => {
    const win = getMainWindow()
    if (!win) return
    // Toggle: if the window is visible AND currently focused, hide it.
    // Otherwise (hidden, minimized, or not focused), reveal & focus.
    if (win.isVisible() && win.isFocused()) {
      win.hide()
    } else {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })
  if (!ok) {
    console.error(`[EasyPrompt] Failed to register shortcut: ${accelerator}`)
  } else {
    console.log(`[EasyPrompt] Shortcut registered: ${accelerator}`)
  }
  return ok
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll()
}
