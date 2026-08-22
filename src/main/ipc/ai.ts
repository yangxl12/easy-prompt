import { ipcMain } from 'electron'
import { IPC, type AICallRequest } from '@shared/types'
import { callAI, testModel } from '../services/ai'

/** Track in-flight streaming AI calls so they can be cancelled. */
const aiControllers = new Map<string, AbortController>()

/** Register all AI IPC handlers (call dispatch + streaming + cancel). */
export function registerAiIpc(): void {
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
