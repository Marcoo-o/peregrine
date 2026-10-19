import { create } from 'zustand'
import i18next from 'i18next'
import type { AppSettings } from '@peregrine/core/types'
import { parseCustomTheme, THEME_TOKENS, type ThemeTokenId } from '@peregrine/core/customTheme'
import { DEFAULT_COLUMNS } from '@peregrine/core/messageColumns'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
  /** Applies a change without hitting the database. For continuous input such as dragging a
   * splitter, where only the final value is worth persisting. */
  setLocal: (patch: Partial<AppSettings>) => void
}

/** Mirrors defaultAppSettings in the main process; used until the stored values arrive. */
const fallback: AppSettings = {
  theme: 'system',
  accentColor: 'blue',
  density: 'comfortable',
  language: 'system',
  notificationsEnabled: true,
  notificationPreview: true,
  notificationMutedAccounts: '[]',
  notificationQuietFrom: '',
  notificationQuietTo: '',
  dayStartHour: 4,
  dailyTagKeyword: '',
  readerPosition: 'bottom',
  sidebarWidth: 240,
  readerPaneHeight: 420,
  readerPaneWidth: 620,
  unifiedFolders: true,
  markReadDelayMs: 0,
  blockRemoteImages: true,
  showPreviewText: false,
  subjectOnly: false,
  sortField: 'date',
  sortDirection: 'desc',
  threadView: false,
  syncIntervalMinutes: 10,
  signByDefault: false,
  experimentalImapClient: false,

  accentCustom: '#4f7cff',
  customTheme: '{}',
  fontScale: 1,
  dateFormat: 'relative',
  messageColumns: JSON.stringify(DEFAULT_COLUMNS),
  columnWidths: '{}',
  savedSearches: '[]',

  warnSuspiciousLinks: true,
  confirmAllLinks: false,
  warnRiskyAttachments: true,
  shortcuts: '{}',
  undoSendSeconds: 5,
  autoLockMinutes: 0
}

/** Mirrors the stored preferences onto <html> so plain CSS can react to them. */
function applyToDocument(settings: AppSettings): void {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.dataset.accent = settings.accentColor
  root.dataset.density = settings.density

  // A free colour cannot live in a stylesheet, so it is handed over as a variable that the
  // [data-accent='custom'] rule picks up.
  root.style.setProperty('--accent-custom', settings.accentCustom)

  // Own colours are applied as inline custom properties, which outrank the stylesheet without
  // needing a rule per token. Tokens the user did not set are cleared so the built-in value
  // takes over again rather than sticking from a previous scheme.
  const theme = parseCustomTheme(settings.customTheme)
  for (const [id, property] of Object.entries(THEME_TOKENS)) {
    const value = theme[id as ThemeTokenId]
    if (value) root.style.setProperty(property, value)
    else root.style.removeProperty(property)
  }
  root.style.setProperty('--font-scale', String(settings.fontScale))

  if (settings.language !== 'system' && i18next.language !== settings.language) {
    void i18next.changeLanguage(settings.language)
  }

  // `lang` is fixed to one value in index.html and stayed that way even when the interface was
  // switched to another language. A screen reader picks its pronunciation from it, and labels
  // read out in the wrong language are harder to follow than no announcement at all.
  // `i18next.language` rather than `settings.language`, because "system" is only resolved there.
  root.lang = i18next.language.split('-')[0]
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: fallback,
  loaded: false,
  load: async () => {
    const settings = await window.peregrine.settings.get()
    applyToDocument(settings)
    set({ settings, loaded: true })
  },
  update: async (patch) => {
    const settings = await window.peregrine.settings.update(patch)
    applyToDocument(settings)
    set({ settings })
  },
  setLocal: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch }
      applyToDocument(settings)
      return { settings }
    })
}))

export function currentSettings(): AppSettings {
  return useSettingsStore.getState().settings
}
