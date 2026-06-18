import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initI18n } from './i18n'
import './styles/globals.css'

// Initialise i18n synchronously BEFORE React renders, so useTranslation() in
// every component finds a ready i18next instance. Language is refined later
// from the loaded config.
initI18n('zh-CN')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
