import zhCN from './zh-CN.json'
import enUS from './en-US.json'

export const messages = {
  'zh-CN': zhCN,
  'en-US': enUS
} as const

export type MessagesShape = typeof zhCN

/** All available languages. */
export const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' }
] as const
