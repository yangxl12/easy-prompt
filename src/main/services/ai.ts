import type { AIModelConfig, AICallRequest, AICallResult } from '@shared/types'
import { getAISettingsInternal } from '../config/store'

/**
 * Unified AI caller. Implements the OpenAI /chat/completions contract with
 * native fetch (Node 22).
 *
 * Vision requests use the standard OpenAI multimodal `content` array with
 * `{type: "image_url"}` parts. Note: DeepSeek's API does NOT support vision —
 * use a provider with a multimodal model (GPT-4o, GLM-5V-Turbo, Qwen-VL-Max).
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >
}

async function findModel(modelId: string): Promise<AIModelConfig> {
  const settings = await getAISettingsInternal()
  const model = settings.models.find((m) => m.id === modelId)
  if (!model) throw new Error(`Model not found: ${modelId}`)
  if (!model.apiKey) throw new Error('This model has no API key configured')
  return model
}

/** Perform a chat completion against an OpenAI-compatible endpoint. */
async function chat(
  model: AIModelConfig,
  modelIdToUse: string,
  messages: ChatMessage[]
): Promise<string> {
  const url = joinUrl(model.baseURL, '/chat/completions')
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${model.apiKey}`
    },
    body: JSON.stringify({
      model: modelIdToUse,
      messages,
      stream: false
    })
  })

  if (!res.ok) {
    const detail = await safeText(res)
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${detail}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }
  if (data.error) throw new Error(data.error.message || 'Unknown provider error')
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty response from model')
  return content
}

/**
 * Streaming chat completion. Returns the full assembled text, and invokes
 * `onDelta` for each token chunk as it arrives (OpenAI SSE `data:` lines).
 * Throws the same errors as `chat`. Falls back gracefully if the provider
 * ignores `stream:true` and returns a normal JSON body.
 */
async function chatStream(
  model: AIModelConfig,
  modelIdToUse: string,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const url = joinUrl(model.baseURL, '/chat/completions')
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${model.apiKey}`,
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({ model: modelIdToUse, messages, stream: true }),
    signal
  })

  if (!res.ok) {
    const detail = await safeText(res)
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${detail}`)
  }

  // Non-SSE fallback: some compatible servers ignore `stream:true` and return
  // a regular JSON body. Detect by content-type and handle it like `chat`.
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json') || !res.body) {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }
    if (data.error) throw new Error(data.error.message || 'Unknown provider error')
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty response from model')
    onDelta(content)
    return content
  }

  // Parse SSE incrementally. We accumulate across `data:` boundaries because a
  //single chunk from Node's stream may contain partial lines.
  let full = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nlIndex: number
    while ((nlIndex = buffer.indexOf('\n')) !== -1) {
      const rawLine = buffer.slice(0, nlIndex)
      buffer = buffer.slice(nlIndex + 1)
      const line = rawLine.replace(/\r$/, '').trim()
      if (!line) continue
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        return full
      }
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string }
            finish_reason?: string | null
          }>
          error?: { message?: string }
        }
        if (json.error) throw new Error(json.error.message || 'Unknown provider error')
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          onDelta(delta)
        }
      } catch (err) {
        // Partial JSON mid-stream — re-buffer the line and wait for more.
        if (err instanceof SyntaxError) {
          buffer = rawLine + '\n' + buffer
          break
        }
        throw err
      }
    }
  }
  return full
}

/** Build messages for a request and dispatch to text vs vision model. */
export async function callAI(
  req: AICallRequest,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal
): Promise<AICallResult> {
  const model = await findModel(req.modelId)

  if (req.task === 'vision') {
    if (!req.images || req.images.length === 0) {
      throw new Error('Vision task requires at least one image')
    }
    // Fall back to the text model id when no dedicated vision model is set.
    // GPT-4o, Qwen-VL-Max and other unified models accept image input on the
    // SAME model id, so an empty visionModel must not hard-fail.
    const visionModelId = model.visionModel?.trim() || model.textModel?.trim()
    if (!visionModelId) {
      throw new Error('No vision model configured for this model entry')
    }
    // 4MB guardrail: providers reject oversized images.
    // A data-URL is "data:image/png;base64,<b64>"; the byte length of the
    // decoded binary ≈ b64chars * 0.75.
    const MAX_BYTES = 4 * 1024 * 1024
    for (const img of req.images) {
      const comma = img.indexOf(',')
      const b64 = comma >= 0 ? img.slice(comma + 1) : img
      const bytes = Math.ceil((b64.length - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)) * 0.75)
      if (bytes > MAX_BYTES) {
        throw new Error(
          `图片过大（约 ${(bytes / 1024 / 1024).toFixed(1)}MB），请控制在 4MB 以内后再试。`
        )
      }
    }

    // DeepSeek's API (api.deepseek.com) does not support vision/image input
    // in any format. Fail fast with a clear message rather than hitting a
    // confusing HTTP 400.
    if (model.provider === 'deepseek') {
      throw new Error(
        'DeepSeek API 不支持图片输入。图片转提示词需要使用支持多模态的模型（如 GPT-4o、GLM-5V-Turbo、Qwen-VL-Max）。请在设置中切换模型或添加新的视觉模型配置。'
      )
    }

    const parts: ChatMessage['content'] = []
    if (req.userText) parts.push({ type: 'text', text: req.userText })
    for (const img of req.images!) {
      parts.push({ type: 'image_url', image_url: { url: img } })
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: parts }
    ]
    try {
      const content = await chat(model, visionModelId, messages)
      return { content }
    } catch (err) {
      throw new Error(`视觉模型「${visionModelId}」调用失败：${(err as Error).message}`)
    }
  }

  // text task
  const messages: ChatMessage[] = [
    { role: 'system', content: req.systemPrompt },
    { role: 'user', content: req.userText ?? '' }
  ]
  const content =
    req.stream && onDelta
      ? await chatStream(model, model.textModel, messages, onDelta, signal)
      : await chat(model, model.textModel, messages)
  return { content }
}

/** Lightweight connectivity + auth check. Throws on failure. */
export async function testModel(modelId: string): Promise<void> {
  const model = await findModel(modelId)
  await chat(model, model.textModel, [
    { role: 'system', content: 'You are a connectivity test.' },
    { role: 'user', content: 'ping' }
  ])
}

/** Join a base URL with a path, tolerating trailing slashes. */
function joinUrl(base: string, p: string): string {
  if (base.endsWith('/')) return base.slice(0, -1) + p
  // Many OpenAI-compatible bases already include /v1; just append the path.
  return base + p
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
