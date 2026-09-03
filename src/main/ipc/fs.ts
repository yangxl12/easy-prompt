import { ipcMain, shell } from 'electron'
import path from 'node:path'
import { IPC } from '@shared/types'
import { getConfigInternal } from '../config/store'
import * as fsService from '../services/fs'
import {
  assertString,
  assertStringArray,
  resolveWorkspacePath
} from '../services/workspacePath'

const MAX_PATH_LEN = 4096
const MAX_CONTENT_CHARS = 16 * 1024 * 1024
const MAX_DELETE_ITEMS = 500

/** Resolve the configured workspace root; fails when none is selected. */
async function workspace(): Promise<string> {
  const root = (await getConfigInternal()).app.workspace
  if (typeof root !== 'string' || root.trim() === '') {
    throw new Error('No workspace selected')
  }
  return root
}

/** Register all file-system IPC handlers. */
export function registerFsIpc(): void {
  ipcMain.handle(IPC.FS_READ_TREE, async () => {
    const root = await workspace()
    return fsService.readTree(root)
  })

  ipcMain.handle(IPC.FS_READ_FILE, async (_e, filePath: unknown) => {
    const root = await workspace()
    return fsService.readFileText(root, assertString(filePath, MAX_PATH_LEN, 'file path'))
  })

  ipcMain.handle(IPC.FS_WRITE_FILE, async (_e, filePath: unknown, content: unknown) => {
    const root = await workspace()
    await fsService.writeFileText(
      root,
      assertString(filePath, MAX_PATH_LEN, 'file path'),
      assertString(content, MAX_CONTENT_CHARS, 'content', true)
    )
    return true
  })

  ipcMain.handle(IPC.FS_CREATE_FILE, async (_e, dir: unknown, name: unknown) => {
    const root = await workspace()
    return fsService.createFile(
      root,
      assertString(dir, MAX_PATH_LEN, 'directory'),
      assertString(name, 200, 'name')
    )
  })

  ipcMain.handle(IPC.FS_CREATE_FOLDER, async (_e, dir: unknown, name: unknown) => {
    const root = await workspace()
    return fsService.createFolder(
      root,
      assertString(dir, MAX_PATH_LEN, 'directory'),
      assertString(name, 200, 'name')
    )
  })

  ipcMain.handle(IPC.FS_CREATE_SIBLING, async (_e, sourcePath: unknown, suffix: unknown) => {
    const root = await workspace()
    return fsService.createSibling(
      root,
      assertString(sourcePath, MAX_PATH_LEN, 'source path'),
      assertString(suffix, 64, 'suffix')
    )
  })

  ipcMain.handle(IPC.FS_RENAME, async (_e, oldPath: unknown, newName: unknown) => {
    const root = await workspace()
    return fsService.rename(
      root,
      assertString(oldPath, MAX_PATH_LEN, 'path'),
      assertString(newName, 200, 'name')
    )
  })

  ipcMain.handle(IPC.FS_DELETE, async (_e, filePath: unknown) => {
    const root = await workspace()
    await fsService.remove(root, assertString(filePath, MAX_PATH_LEN, 'path'))
    return true
  })

  ipcMain.handle(IPC.FS_DELETE_MULTI, async (_e, filePaths: unknown) => {
    const root = await workspace()
    for (const p of assertStringArray(filePaths, MAX_DELETE_ITEMS, MAX_PATH_LEN, 'path')) {
      await fsService.remove(root, p)
    }
    return true
  })

  ipcMain.handle(IPC.FS_COPY, async (_e, src: unknown) => {
    const root = await workspace()
    return fsService.copy(root, assertString(src, MAX_PATH_LEN, 'path'))
  })

  ipcMain.handle(IPC.FS_SHOW_IN_FOLDER, async (_e, filePath: unknown) => {
    const root = await workspace()
    const p = await resolveWorkspacePath(
      root,
      assertString(filePath, MAX_PATH_LEN, 'file path')
    )
    await shell.openPath(path.dirname(p))
    return true
  })

  // Watch the workspace and push change events back to the renderer.
  // One timer per subscribing webContents: re-subscribing replaces it, and
  // destroying the window cleans up — no leaked or clobbered intervals.
  const watchers = new Map<number, NodeJS.Timeout>()

  const stopWatcher = (id: number): void => {
    const timer = watchers.get(id)
    if (timer) clearInterval(timer)
    watchers.delete(id)
  }

  ipcMain.on(IPC.FS_WATCH, (event) => {
    const senderId = event.sender.id
    stopWatcher(senderId)
    // Debounced polling — simple & cross-platform. chokidar would be heavier.
    let inFlight = false
    const tick = async (): Promise<void> => {
      if (inFlight || event.sender.isDestroyed()) return
      inFlight = true
      try {
        const root = await workspace()
        const tree = await fsService.readTree(root)
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.FS_WATCH, tree)
        }
      } catch {
        /* workspace may be transiently unavailable */
      } finally {
        inFlight = false
      }
    }
    watchers.set(senderId, setInterval(() => void tick(), 1500))
    event.sender.once('destroyed', () => stopWatcher(senderId))
    void tick()
  })

  ipcMain.on(IPC.FS_WATCH_STOP, (event) => {
    stopWatcher(event.sender.id)
  })
}
