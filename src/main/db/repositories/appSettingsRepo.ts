import type { SqlDb } from '../sqlDb'
import type { AppSettings } from '@peregrine/core/types'
import { DEFAULT_COLUMNS } from '@peregrine/core/messageColumns'

export const defaultAppSettings: AppSettings = {
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

/**
 * app_settings is a key/value table, so every value round-trips as text. Declaring the kind of
 * each key in one place keeps read and write symmetric. Adding a setting means adding a line
 * here, not a parse branch plus a serialize branch.
 */
type SettingKind = 'string' | 'boolean' | 'number'

const SETTING_KINDS: Record<keyof AppSettings, SettingKind> = {
  theme: 'string',
  accentColor: 'string',
  density: 'string',
  language: 'string',
  notificationsEnabled: 'boolean',
  notificationPreview: 'boolean',
  notificationMutedAccounts: 'string',
  notificationQuietFrom: 'string',
  notificationQuietTo: 'string',
  dayStartHour: 'number',
  dailyTagKeyword: 'string',
  readerPosition: 'string',
  sidebarWidth: 'number',
  readerPaneHeight: 'number',
  readerPaneWidth: 'number',
  unifiedFolders: 'boolean',
  markReadDelayMs: 'number',
  blockRemoteImages: 'boolean',
  showPreviewText: 'boolean',
  subjectOnly: 'boolean',
  sortField: 'string',
  sortDirection: 'string',
  threadView: 'boolean',
  syncIntervalMinutes: 'number',
  signByDefault: 'boolean',
  experimentalImapClient: 'boolean',

  accentCustom: 'string',
  customTheme: 'string',
  fontScale: 'number',
  dateFormat: 'string',
  messageColumns: 'string',
  columnWidths: 'string',
  savedSearches: 'string',

  warnSuspiciousLinks: 'boolean',
  confirmAllLinks: 'boolean',
  warnRiskyAttachments: 'boolean',
  shortcuts: 'string',
  undoSendSeconds: 'number',
  autoLockMinutes: 'number'
}

const SETTING_KEYS = Object.keys(SETTING_KINDS) as (keyof AppSettings)[]

function parseValue(key: keyof AppSettings, raw: string | undefined): unknown {
  if (raw == null) return defaultAppSettings[key]
  switch (SETTING_KINDS[key]) {
    case 'boolean':
      return raw === 'true'
    case 'number': {
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? parsed : defaultAppSettings[key]
    }
    default:
      return raw
  }
}

export async function getAppSettings(db: SqlDb): Promise<AppSettings> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM app_settings')
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  const settings = { ...defaultAppSettings }
  for (const key of SETTING_KEYS) {
    // Index-signature-free assignment: each key keeps its own type in AppSettings.
    ;(settings as Record<string, unknown>)[key] = parseValue(key, stored[key])
  }
  return settings
}

export async function updateAppSettings(
  db: SqlDb,
  patch: Partial<AppSettings>
): Promise<AppSettings> {
  const entries = Object.entries(patch)
    .filter(([key]) => key in SETTING_KINDS)
    .map(([k, v]) => [k, String(v)] as [string, string])
  await db.transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx.run(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        key,
        value
      )
    }
  })

  return getAppSettings(db)
}
