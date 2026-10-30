import type { SqlDb } from '@peregrine/core/sqlDb'

/** Whether the application is light or dark whatever the system is, or follows it. */
export type AppearanceMode = 'system' | 'light' | 'dark'

export const APPEARANCE_CHOICES: ReadonlyArray<{ mode: AppearanceMode; label: string }> = [
  { mode: 'system', label: 'Wie das System' },
  { mode: 'light', label: 'Hell' },
  { mode: 'dark', label: 'Dunkel' }
]

const NAME = 'appearance'

/** The mode as stored, `system` for what is missing or is not one. */
export async function loadAppearance(db: SqlDb): Promise<AppearanceMode> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return 'system'
  try {
    const mode = (JSON.parse(row.value) as { mode?: unknown } | null)?.mode
    return mode === 'light' || mode === 'dark' ? mode : 'system'
  } catch {
    return 'system'
  }
}

export async function saveAppearance(db: SqlDb, mode: AppearanceMode): Promise<AppearanceMode> {
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify({ mode })
  )
  return mode
}

type Listener = () => void

/**
 * The mode that is in force, outside React, because the theme is asked for in places that are not under a provider (the status bar,
 * the first screen before the application exists). The screens subscribe to it.
 */
let current: AppearanceMode = 'system'
const listeners = new Set<Listener>()

export const appearance = {
  get mode(): AppearanceMode {
    return current
  },
  set(mode: AppearanceMode): void {
    if (mode === current) return
    current = mode
    listeners.forEach((listener) => listener())
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}

/** The scheme to draw in: what was chosen, or the system's where nothing was. */
export function schemeFor(mode: AppearanceMode, system: 'light' | 'dark' | null | undefined): 'light' | 'dark' {
  return mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode
}
