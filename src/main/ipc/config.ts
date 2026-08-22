import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC, defaultShortcut, type AppConfig, type AppConfigPatch } from '@shared/types'
import {
  getConfigForRenderer,
  setConfig,
  patchConfig,
  getConfigInternal
} from '../config/store'
import { registerShortcut } from '../shortcut'
import { rebuildTrayMenu } from '../tray'

/**
 * Normalize an Electron accelerator string: replace literal space
 * characters with the word "Space", which is what Electron's
 * globalShortcut.register() expects.
 */
function normalizeAccelerator(accel: string): string {
  return accel.replace(/ \+ $/, '+Space').replace(/^ $/, 'Space')
}

/** Register all config-related IPC handlers. */
export function registerConfigIpc(): void {
  ipcMain.handle(IPC.CONFIG_GET, async (): Promise<AppConfig> => getConfigForRenderer())

  ipcMain.handle(IPC.CONFIG_SET, async (_e, next: AppConfig): Promise<AppConfig> => {
    await setConfig(next)
    return getConfigForRenderer()
  })

  ipcMain.handle(IPC.CONFIG_SET_PARTIAL, async (_e, patch: AppConfigPatch): Promise<AppConfig> => {
    // Normalize shortcut: Electron accelerators use "Space" not the literal space char.
    if (patch.app?.shortcut) {
      patch.app.shortcut = normalizeAccelerator(patch.app.shortcut)
    }
    await patchConfig(patch)
    // Re-register the global shortcut if it changed.
    if (patch.app?.shortcut !== undefined) {
      const accel = patch.app.shortcut || defaultShortcut(process.platform)
      if (!registerShortcut(accel)) {
        console.warn(`[EasyPrompt] Shortcut "${accel}" failed to register — falling back to default`)
        registerShortcut(defaultShortcut(process.platform))
      }
    }
    // Rebuild tray menu if the language changed.
    if (patch.app?.language !== undefined) {
      rebuildTrayMenu(patch.app.language)
    }
    return getConfigForRenderer()
  })

  // Open native folder picker; returns the chosen path or null.
  ipcMain.handle(IPC.CONFIG_SELECT_WORKSPACE, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select workspace folder'
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  // Change workspace path — simply updates the config to point at the chosen folder.
  ipcMain.handle(
    IPC.CONFIG_CHANGE_WORKSPACE,
    async (_e, newPath: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const config = await getConfigInternal()

        // No-op if the path didn't actually change.
        if (config.app.workspace === newPath) return { success: true }

        // Persist the new path — no file migration, just point at the folder.
        await patchConfig({ app: { workspace: newPath } })

        // Broadcast so the renderer's config store (workspace root, etc.) stays in sync.
        void broadcastConfig()

        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )
}

/** Broadcast a config update to every renderer window. */
export async function broadcastConfig(): Promise<void> {
  const cfg = await getConfigForRenderer()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:changed', cfg)
    }
  }
}
