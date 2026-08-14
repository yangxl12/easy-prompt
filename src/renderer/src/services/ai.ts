import type { AICallResult, Language } from '@shared/types'
import { useConfigStore } from '../store/config'
import { randomLocalId } from './ids'

/**
 * Renderer-side AI client. Picks the currently-active model and dispatches to
 * the main process (which holds the real API key and performs the HTTP call).
 */

function currentModelId(): string {
  const model = useConfigStore.getState().currentModel()
  if (!model) throw new Error('No AI model configured')
  return model.id
}

/** Map app language to a natural-language name the model understands. */
function languageName(lang: Language): string {
  return lang === 'zh-CN' ? 'Simplified Chinese' : 'English'
}

/**
 * Detect the dominant natural language of `text` so we can pin the output to
 * the same language. We look at CJK characters first (unambiguous), then fall
 * back to the app's UI language. Returning the language name in the system
 * prompt is what actually stops the model from translating everything to
 * English — a soft "keep the language" hint is not enough.
 */
function detectLanguageName(text: string, fallback: Language): string {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  if (cjk > 0 && cjk >= latin * 0.3) return 'Simplified Chinese'
  if (latin > 0) return 'English'
  return languageName(fallback)
}

/**
 * Stream an AI text call with abort support. Returns a promise for the
 * assembled text and a synchronous abort function that cancels the in-flight
 * call immediately.
 *
 * Streaming is used so the UI can show the produced text as it arrives,
 * rather than blocking until the whole response is ready. When `onDelta` is
 * supplied, it is invoked for each incremental token chunk; the final
 * fully-assembled text is still returned by the promise.
 *
 * The abort function is returned synchronously — callers can cancel
 * immediately without waiting for the promise to settle.
 */
function streamText(
  systemPrompt: string,
  text: string,
  onDelta?: (delta: string) => void
): { result: Promise<{ result: string; aborted: boolean }>; abort: () => void } {
  // Stream: subscribe FIRST, then issue the call. Because we generate the
  // streamId here and pass it to main, every chunk — even ones that arrive
  // before invoke resolves — is matched to this call.
  let unsub: (() => void) | null = null
  const streamId = onDelta ? randomLocalId() : undefined
  let aborted = false
  let errorFromStream: string | null = null

  if (onDelta && streamId) {
    unsub = window.api.onAIStreamChunk((chunk) => {
      if (chunk.id !== streamId) return
      if (chunk.error === 'cancelled') {
        aborted = true
        return
      }
      if (chunk.error) {
        errorFromStream = chunk.error
        return
      }
      if (chunk.delta) onDelta(chunk.delta)
    })
  }

  const abort = (): void => {
    if (streamId) {
      void window.api.cancelAI(streamId)
    }
    aborted = true
  }

  const result = (async (): Promise<{ result: string; aborted: boolean }> => {
    try {
      const res: AICallResult = await window.api.callAI({
        modelId: currentModelId(),
        task: 'text',
        systemPrompt,
        userText: text,
        stream: Boolean(onDelta),
        streamId
      })
      if (aborted) {
        // Partial result on abort — return what we have so far.
        return { result: res.content?.trim() ?? '', aborted: true }
      }
      if (errorFromStream) {
        throw new Error(errorFromStream)
      }
      return { result: res.content.trim(), aborted: false }
    } catch (err) {
      if (aborted) {
        return { result: '', aborted: true }
      }
      throw err
    } finally {
      if (unsub) unsub()
    }
  })()

  return { result, abort }
}

/**
 * Optimize (polish) a prompt. Two things keep the model from silently
 * translating the prompt into English:
 *  1. We detect the original prompt's language and name it explicitly.
 *  2. The instruction "DO NOT translate" is stated as a hard rule, up front.
 */
export function optimizePrompt(
  text: string,
  onDelta?: (delta: string) => void
): { result: Promise<{ result: string; aborted: boolean }>; abort: () => void } {
  const appLang = useConfigStore.getState().config.app.language
  const outLang = detectLanguageName(text, appLang)
  const systemPrompt = [
    'You are a prompt engineer. Polish the user-provided prompt to make it clearer, more fluent, and better structured.',
    'CRITICAL: The output MUST be written in ' + outLang + '.',
    'DO NOT translate the prompt into another language — keep it in the same language as the original.',
    'Preserve the core intent exactly — do not add or remove requirements.',
    'Keep all code, variable names, identifiers, and URLs unchanged.',
    'Respond with ONLY the improved prompt text, no preamble, no explanation, no code fences.'
  ].join(' ')
  return streamText(systemPrompt, text, onDelta)
}

/**
 * Polish a piece of prose (articles, notes, journals). Unlike optimizePrompt,
 * this targets everyday writing: smoother flow, clearer logic, and a touch of
 * elegance — without changing the facts or meaning.
 */
export function polishText(
  text: string,
  onDelta?: (delta: string) => void
): { result: Promise<{ result: string; aborted: boolean }>; abort: () => void } {
  const appLang = useConfigStore.getState().config.app.language
  const outLang = detectLanguageName(text, appLang)
  const systemPrompt = [
    'You are a skilled copy editor for everyday writing — articles, notes, and journals.',
    'Polish the provided text so it reads smoothly and naturally, with clear logic and a touch of literary elegance that makes it pleasant to read.',
    'CRITICAL: The output MUST be written in ' + outLang + '.',
    'DO NOT translate the text into another language — keep it in the same language as the original.',
    'Preserve the original meaning, facts, and personal voice exactly — do not add, remove, or invent content.',
    'Keep names, numbers, dates, code, and URLs unchanged.',
    'Respond with ONLY the polished text, no preamble, no explanation, no code fences.'
  ].join(' ')
  return streamText(systemPrompt, text, onDelta)
}

/** Describe a UI image and turn it into a structured prompt. */
export async function imageToPrompt(dataUrl: string): Promise<string> {
  const res: AICallResult = await window.api.callAI({
    modelId: currentModelId(),
    task: 'vision',
    systemPrompt:
      'You analyze UI design screenshots and convert them into detailed implementation prompts. Describe layout, components, spacing, colors, typography, and interactions. Respond with a well-structured Markdown prompt that a developer or AI could use to reproduce the UI.',
    // An explicit user turn helps some vision models (e.g. Zhipu GLM-4V) that
    // under-perform or refuse when the user message has no text.
    userText:
      'Analyze this UI screenshot and produce a detailed, well-structured Markdown implementation prompt.',
    images: [dataUrl]
  })
  return res.content.trim()
}
