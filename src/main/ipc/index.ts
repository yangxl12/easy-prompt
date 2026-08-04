import { ipcMain, shell, dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import { IPC, type AppConfig, type AppConfigPatch, type AICallRequest } from '@shared/types'
import {
  getConfigForRenderer,
  setConfig,
  patchConfig,
  getConfigInternal
} from '../config/store'
import * as fsService from '../services/fs'
import { callAI, testModel } from '../services/ai'
import { registerShortcut } from '../shortcut'
import { defaultShortcut } from '@shared/types'
import { rebuildTrayMenu } from '../tray'

/**
 * Normalize an Electron accelerator string: replace literal space
 * characters with the word "Space", which is what Electron's
 * globalShortcut.register() expects.
 */
function normalizeAccelerator(accel: string): string {
  return accel.replace(/ \+ $/, '+Space').replace(/^ $/, 'Space')
}

/**
 * Register every IPC handler. Called once at app boot.
 * Handlers receive plain JSON arguments (validated by TS contracts at the
 * renderer side) and return data or throw Error → ipcRenderer.invoke rejects.
 */
export function registerIpc(): void {
  registerConfigIpc()
  registerFsIpc()
  registerAiIpc()
}

/* ----------------------------- config ----------------------------- */
function registerConfigIpc(): void {
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

/* ----------------------------- fs ----------------------------- */
async function workspace(): Promise<string> {
  return (await getConfigInternal()).app.workspace
}

function registerFsIpc(): void {
  ipcMain.handle(IPC.FS_READ_TREE, async () => {
    const root = await workspace()
    return fsService.readTree(root)
  })

  ipcMain.handle(IPC.FS_READ_FILE, async (_e, filePath: string) =>
    fsService.readFileText(filePath)
  )

  ipcMain.handle(IPC.FS_WRITE_FILE, async (_e, filePath: string, content: string) => {
    await fsService.writeFileText(filePath, content)
    return true
  })

  ipcMain.handle(IPC.FS_CREATE_FILE, async (_e, dir: string, name: string) => {
    const root = await workspace()
    return fsService.createFile(root, fsService.resolveInWorkspace(root, dir), name)
  })

  ipcMain.handle(IPC.FS_CREATE_FOLDER, async (_e, dir: string, name: string) => {
    const root = await workspace()
    return fsService.createFolder(root, fsService.resolveInWorkspace(root, dir), name)
  })

  ipcMain.handle(IPC.FS_RENAME, async (_e, oldPath: string, newName: string) => {
    const root = await workspace()
    return fsService.rename(root, oldPath, newName)
  })

  ipcMain.handle(IPC.FS_DELETE, async (_e, filePath: string) => {
    await fsService.remove(filePath)
    return true
  })

  ipcMain.handle(IPC.FS_DELETE_MULTI, async (_e, filePaths: string[]) => {
    for (const p of filePaths) {
      await fsService.remove(p)
    }
    return true
  })

  ipcMain.handle(IPC.FS_COPY, async (_e, src: string) => {
    const root = await workspace()
    return fsService.copy(root, src)
  })

  ipcMain.handle(IPC.FS_SHOW_IN_FOLDER, async (_e, filePath: string) => {
    await shell.openPath(path.dirname(filePath))
    return true
  })

  // Watch the workspace and push change events back to renderer.
  let watcherTimer: NodeJS.Timeout | null = null
  ipcMain.on(IPC.FS_WATCH, (event) => {
    // Debounced polling — simple & cross-platform. chokidar would be heavier.
    const tick = async (): Promise<void> => {
      try {
        const root = await workspace()
        const tree = await fsService.readTree(root)
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.FS_WATCH, tree)
        }
      } catch {
        /* workspace may be transiently unavailable */
      }
    }
    watcherTimer = setInterval(tick, 1500)
    void tick()
  })

  ipcMain.on('fs:watch-stop', () => {
    if (watcherTimer) clearInterval(watcherTimer)
    watcherTimer = null
  })
}

/* ----------------------------- ai ----------------------------- */
/** Track in-flight streaming AI calls so they can be cancelled. */
const aiControllers = new Map<string, AbortController>()

function registerAiIpc(): void {
  ipcMain.handle(IPC.AI_CALL, async (event, req: AICallRequest) => {
    if (req.stream) {
      // Streaming: use the client-provided streamId to correlate chunks, push
      // each delta back via a dedicated event, then resolve the invoke with
      // the fully-assembled result.
      const id = req.streamId ?? ''
      const send = (delta: string): void => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.AI_STREAM_CHUNK, { id, delta, done: false })
        }
      }
      // Create an AbortController so the renderer can cancel mid-stream.
      const ctrl = new AbortController()
      aiControllers.set(id, ctrl)
      try {
        const result = await callAI(req, send, ctrl.signal)
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.AI_STREAM_CHUNK, { id, delta: '', done: true })
        }
        return { ...result, streamId: id }
      } catch (err) {
        const isAbort = (err as Error).name === 'AbortError'
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.AI_STREAM_CHUNK, {
            id,
            delta: '',
            done: true,
            error: isAbort ? 'cancelled' : (err as Error).message
          })
        }
        throw err
      } finally {
        aiControllers.delete(id)
      }
    }
    return callAI(req)
  })

  // Cancel an in-flight streaming AI call.
  ipcMain.handle(IPC.AI_CANCEL, async (_e, streamId: string) => {
    const ctrl = aiControllers.get(streamId)
    if (ctrl) {
      ctrl.abort()
      aiControllers.delete(streamId)
    }
  })
  ipcMain.handle(IPC.AI_TEST, async (_e, modelId: string) => {
    await testModel(modelId)
    return true
  })
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
