import { writeFile } from './fileOps'

/**
 * Per-path serialized write queue. Auto-save and manual saves for the same
 * file can overlap (write A in flight while B is requested); chaining them
 * guarantees they hit the disk in request order instead of racing.
 *
 * The returned promise rejects if THIS write failed; the chain itself stays
 * alive so a failure doesn't wedge subsequent writes.
 */
const queues = new Map<string, Promise<void>>()

/** Queue `content` to be written to `path` after any pending write completes. */
export function enqueueWrite(path: string, content: string): Promise<void> {
  const prev = queues.get(path) ?? Promise.resolve()
  const task = prev.then(() => writeFile(path, content))
  queues.set(
    path,
    task.then(
      () => undefined,
      () => undefined
    )
  )
  return task
}
