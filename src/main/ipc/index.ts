/**
 * IPC layer entry — thin re-export so `import { registerIpc } from './ipc'`
 * keeps working while the handlers live in per-domain modules:
 *  - `config.ts`: settings + workspace selection + config:changed broadcast.
 *  - `fs.ts`: markdown file tree CRUD + the 1.5s workspace watcher.
 *  - `ai.ts`: AI call dispatch, streaming chunks and cancellation.
 *  - `register.ts`: composition root registering all domains.
 */
export { registerIpc } from './register'
export { broadcastConfig } from './config'
