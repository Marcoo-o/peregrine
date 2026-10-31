import type { SqlDb } from '@peregrine/core/sqlDb'
import type { Density } from './ui/scaleStyles'
import { ACCENTS, DEFAULT_ACCENT, type AccentName } from './ui/theme'
import { msg } from './i18n'

/** Whether the application is light or dark whatever the system is, or follows it. */
export type AppearanceMode = 'system' | 'light' | 'dark'

export const APPEARANCE_CHOICES: ReadonlyArray<{ mode: AppearanceMode; label: string }> = [
  { mode: 'system', label: msg('Wie das System') },
  { mode: 'light', label: msg('Hell') },
  { mode: 'dark', label: msg('Dunkel') }
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
  { scale: 'small', label: msg('Klein'), factor: 0.9 },
  { scale: 'normal', label: msg('Normal'), factor: 1 },
  { scale: 'large', label: msg('Groß'), factor: 1.15 },
  { scale: 'xlarge', label: msg('Sehr groß'), factor: 1.3 }
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

/** How a date is written in a list: the time for today and the day for the rest, a short date, a long one with the time, or the ISO date. */
export type DateFormat = 'relative' | 'short' | 'long' | 'iso'

export const DATE_FORMATS: ReadonlyArray<{ format: DateFormat; label: string }> = [
  { format: 'relative', label: msg('Heute die Uhrzeit') },
  { format: 'short', label: msg('Kurz') },
  { format: 'long', label: msg('Lang') },
  { format: 'iso', label: 'ISO' }
]

export const DENSITIES: ReadonlyArray<{ density: Density; label: string }> = [
  { density: 'comfortable', label: msg('Locker') },
  { density: 'cozy', label: msg('Normal') },
  { density: 'compact', label: msg('Eng') }
]

/** What the user chose of how the application looks besides light and dark and the size of the text. */
export interface Look {
  accent: AccentName
  dateFormat: DateFormat
  density: Density
}

export const DEFAULT_LOOK: Look = { accent: DEFAULT_ACCENT, dateFormat: 'relative', density: 'cozy' }

const LOOK_NAME = 'look'

/** The look as stored, each part that is missing or is not a choice taking its default. */
export async function loadLook(db: SqlDb): Promise<Look> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', LOOK_NAME)
  if (!row) return DEFAULT_LOOK
  try {
    const given = (JSON.parse(row.value) as Record<string, unknown> | null) ?? {}
    return {
      accent: typeof given.accent === 'string' && given.accent in ACCENTS ? (given.accent as AccentName) : DEFAULT_LOOK.accent,
      dateFormat: DATE_FORMATS.some((choice) => choice.format === given.dateFormat) ? (given.dateFormat as DateFormat) : DEFAULT_LOOK.dateFormat,
      density: DENSITIES.some((choice) => choice.density === given.density) ? (given.density as Density) : DEFAULT_LOOK.density
    }
  } catch {
    return DEFAULT_LOOK
  }
}

export async function saveLook(db: SqlDb, change: Partial<Look>): Promise<Look> {
  const next = { ...(await loadLook(db)), ...change }
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    LOOK_NAME,
    JSON.stringify(next)
  )
  return next
}

let currentLook: Look = DEFAULT_LOOK
const lookListeners = new Set<Listener>()

/** The look in force, outside React for the same reason as the mode. A new object for each change, so that what reads it can tell. */
export const look = {
  get current(): Look {
    return currentLook
  },
  set(next: Look): void {
    if (next.accent === currentLook.accent && next.dateFormat === currentLook.dateFormat && next.density === currentLook.density) return
    currentLook = next
    lookListeners.forEach((listener) => listener())
  },
  subscribe(listener: Listener): () => void {
    lookListeners.add(listener)
    return () => lookListeners.delete(listener)
  }
}
