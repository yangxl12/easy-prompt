import type { EasyPromptAPI } from './index'

declare global {
  interface Window {
    api: EasyPromptAPI
  }
}

export {}
