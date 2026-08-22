import { registerConfigIpc } from './config'
import { registerFsIpc } from './fs'
import { registerAiIpc } from './ai'

/**
 * Register every IPC handler, grouped by domain. Called once at app boot.
 * Handlers receive plain JSON arguments (validated by TS contracts at the
 * renderer side) and return data or throw Error → ipcRenderer.invoke rejects.
 */
export function registerIpc(): void {
  registerConfigIpc()
  registerFsIpc()
  registerAiIpc()
}
