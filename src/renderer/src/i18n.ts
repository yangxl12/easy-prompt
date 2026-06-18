import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { messages } from '@shared/i18n'
import type { Language } from '@shared/types'

/** Initialise i18next with bundled zh-CN / en-US resources. Default: zh-CN. */
export function initI18n(language: Language = 'zh-CN'): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: {
        'zh-CN': { translation: messages['zh-CN'] },
        'en-US': { translation: messages['en-US'] }
      },
      lng: language,
      fallbackLng: 'zh-CN',
      interpolation: { escapeValue: false }
    })
  } else if (i18n.language !== language) {
    void i18n.changeLanguage(language)
  }
  return i18n
}

export default i18n
