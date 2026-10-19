import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './i18n'
import './styles.css'
// Feature-owned stylesheets, kept separate so each area's styles live next to its work.
import './styles/filters.css'
import './styles/pgp.css'
import './styles/linkSafety.css'
import './styles/folders.css'
import './styles/diagnostics.css'
import './styles/prompt.css'
import './styles/savedSearch.css'
import './styles/notifications.css'
import './styles/snooze.css'
import './styles/pending.css'
import './styles/daily.css'
import './styles/about.css'
import { applyScrollbarSize } from './util/scrollbarSize'

// Before the first render, because the message list reads the width from that CSS variable.
applyScrollbarSize()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

