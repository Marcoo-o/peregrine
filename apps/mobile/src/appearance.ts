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

/** How large the texts of the application are, on top of what the system's own setting makes them. */
export type FontScale = 'small' | 'normal' | 'large' | 'xlarge'

export const FONT_SCALES: ReadonlyArray<{ scale: FontScale; label: string; factor: number }> = [
  { scale: 'small', label: 'Klein', factor: 0.9 },
  { scale: 'normal', label: 'Normal', factor: 1 },
  { scale: 'large', label: 'Groß', factor: 1.15 },
  { scale: 'xlarge', label: 'Sehr groß', factor: 1.3 }
]

/** The number a size is multiplied by. */
export function fontFactor(scale: FontScale): number {
  return FONT_SCALES.find((choice) => choice.scale === scale)?.factor ?? 1
}

const SCALE_NAME = 'fontScale'

/** The scale as stored, `normal` for what is missing or is not one. */
export async function loadFontScale(db: SqlDb): Promise<FontScale> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', SCALE_NAME)
  if (!row) return 'normal'
  try {
    const scale = (JSON.parse(row.value) as { scale?: unknown } | null)?.scale
    return FONT_SCALES.some((choice) => choice.scale === scale) ? (scale as FontScale) : 'normal'
  } catch {
    return 'normal'
  }
}

export async function saveFontScale(db: SqlDb, scale: FontScale): Promise<FontScale> {
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    SCALE_NAME,
    JSON.stringify({ scale })
  )
  return scale
}

let currentScale: FontScale = 'normal'
const scaleListeners = new Set<Listener>()

/** The scale that is in force, outside React for the same reason as the mode. */
export const fontScale = {
  get scale(): FontScale {
    return currentScale
  },
  set(scale: FontScale): void {
    if (scale === currentScale) return
    currentScale = scale
    scaleListeners.forEach((listener) => listener())
  },
  subscribe(listener: Listener): () => void {
    scaleListeners.add(listener)
    return () => scaleListeners.delete(listener)
  }
}
