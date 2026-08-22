import { ipcMain, shell } from 'electron'
import path from 'node:path'
import { IPC } from '@shared/types'
import { getConfigInternal } from '../config/store'
import * as fsService from '../services/fs'

/** Resolve the configured workspace root. */
async function workspace(): Promise<string> {
  return (await getConfigInternal()).app.workspace
}

/** Register all file-system IPC handlers. */
export function registerFsIpc(): void {
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
