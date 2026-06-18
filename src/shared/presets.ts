import type { AIModelConfig } from './types'

/**
 * Built-in model presets. Shown as one-click imports in Settings.
 * All are OpenAI-compatible — the same /chat/completions contract.
 *
 * Vision support:
 *  - DeepSeek: API does NOT support vision. visionModel is left empty;
 *    image-to-prompt will show a clear error and suggest switching models.
 *  - Zhipu: glm-5.1 for text polish, glm-5v-turbo for vision.
 */
export const MODEL_PRESETS: ReadonlyArray<Omit<AIModelConfig, 'id' | 'apiKey'>> = [
  {
    name: 'DeepSeek V4-Pro',
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    textModel: 'deepseek-v4-pro',
    visionModel: '' // DeepSeek API has no vision capability
  },
  {
    name: 'Zhipu GLM (智谱)',
    provider: 'zhipu',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    textModel: 'glm-5.1',
    visionModel: 'glm-5v-turbo'
  }
]

/** Generate a pseudo-unique id without pulling in a uuid dep at import time. */
export function newModelId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
