import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import {
  IPC,
  type AppConfig,
  type AppConfigPatch,
  type AICallRequest,
  type AICallResult,
  type AIStreamChunk,
  type FileNode
} from '@shared/types'

/**
 * Typed bridge between renderer and main. The renderer imports `window.api`
 * whose shape is `EasyPromptAPI` (declared below) — full type safety with no
 * Node access leaking into the renderer.
 */

interface FileWatcherCallbacks {
  onTree: (tree: FileNode) => void
}

const api = {
  /* ----- meta ----- */
  platform: process.platform,

  /* ----- config ----- */
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.CONFIG_GET),
  setConfig: (config: AppConfig): Promise<AppConfig> =>
    ipcRenderer.invoke(IPC.CONFIG_SET, config),
  patchConfig: (patch: AppConfigPatch): Promise<AppConfig> =>
    ipcRenderer.invoke(IPC.CONFIG_SET_PARTIAL, patch),
  /** Subscribe to config changes broadcast from main. Returns an unsub fn. */
  onConfigChanged: (cb: (config: AppConfig) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, config: AppConfig): void => cb(config)
    ipcRenderer.on('config:changed', listener)
    return () => ipcRenderer.off('config:changed', listener)
  },

  /* ----- fs ----- */
  readTree: (): Promise<FileNode> => ipcRenderer.invoke(IPC.FS_READ_TREE),
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FS_READ_FILE, filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FS_WRITE_FILE, filePath, content),
  createFile: (dir: string, name: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FS_CREATE_FILE, dir, name),
  createFolder: (dir: string, name: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FS_CREATE_FOLDER, dir, name),
  rename: (oldPath: string, newName: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FS_RENAME, oldPath, newName),
  /**
   * Create `"<name><suffix>.md"` next to `sourcePath` (computed in main with
   * node:path so Windows separators are correct). Returns the new file path.
   */
  createSiblingFile: (sourcePath: string, suffix: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FS_CREATE_SIBLING, sourcePath, suffix),
  remove: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FS_DELETE, filePath),
  removeMulti: (filePaths: string[]): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FS_DELETE_MULTI, filePaths),
  copy: (src: string): Promise<string> => ipcRenderer.invoke(IPC.FS_COPY, src),
  showInFolder: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FS_SHOW_IN_FOLDER, filePath),

  /** Start watching the workspace; cb fires with the latest tree on changes. */
  watchWorkspace: (cb: FileWatcherCallbacks['onTree']): (() => void) => {
    const listener = (_e: IpcRendererEvent, tree: FileNode): void => cb(tree)
    ipcRenderer.on(IPC.FS_WATCH, listener)
    ipcRenderer.send(IPC.FS_WATCH)
    return () => {
      ipcRenderer.off(IPC.FS_WATCH, listener)
      ipcRenderer.send(IPC.FS_WATCH_STOP)
    }
  },

  /* ----- workspace ----- */
  /** Open native folder picker; returns chosen path or null. */
  selectWorkspace: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.CONFIG_SELECT_WORKSPACE),
  /** Change workspace path — repoints the config only; files are NOT migrated. */
  changeWorkspace: (newPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.CONFIG_CHANGE_WORKSPACE, newPath),

  /* ----- tray events ----- */
  /** Fires when tray menu "New Prompt" is clicked. */
  onTrayNewPrompt: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('tray:new-prompt', listener)
    return () => ipcRenderer.off('tray:new-prompt', listener)
  },
  /** Fires when tray menu "Settings…" is clicked. */
  onTrayOpenSettings: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('tray:open-settings', listener)
    return () => ipcRenderer.off('tray:open-settings', listener)
  },

  /* ----- ai ----- */
  callAI: (req: AICallRequest): Promise<AICallResult> =>
    ipcRenderer.invoke(IPC.AI_CALL, req),
  /** Cancel an in-flight streaming AI call. */
  cancelAI: (streamId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.AI_CANCEL, streamId),
  /**
   * Subscribe to streaming delta events. The callback receives every chunk
   * main emits; filter by the `streamId` returned from `callAI`. Returns an
   * unsubscribe fn.
   */
  onAIStreamChunk: (cb: (chunk: AIStreamChunk) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, chunk: AIStreamChunk): void => cb(chunk)
    ipcRenderer.on(IPC.AI_STREAM_CHUNK, listener)
    return () => ipcRenderer.off(IPC.AI_STREAM_CHUNK, listener)
  },
  testModel: (modelId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.AI_TEST, modelId)
}

export type EasyPromptAPI = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // Fallback (not used since contextIsolation is on, kept for safety).
  ;(window as unknown as { api: EasyPromptAPI }).api = api
}
