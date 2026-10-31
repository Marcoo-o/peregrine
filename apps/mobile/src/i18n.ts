import type { SqlDb } from '@peregrine/core/sqlDb'
import en from './locales/en.json'

/**
 * The languages of the application.
 *
 * Every text a person reads goes through `t`, `tn` or `msg`, and the text that is written there, in German, is the source: it is what is shown for German and what
 * every catalog is keyed by. A catalog (`locales/<language>.json`) has the translation of each text, and a language that has none for one falls back to English
 * and then to the source, so a text is never missing, only untranslated. `scripts/mobile-strings.mjs` finds the texts that are not yet moved here, and the
 * test of the catalogs finds the translations that are missing, left over, or have other placeholders than the text they translate.
 *
 * Adding a language is a file in `locales` and a line in `LANGUAGES`: no code changes.
 */
export interface LanguageInfo {
  code: string
  /** The name of the language in the language itself, which is how a person looks for it. */
  name: string
  /** The locale dates and numbers are written in. */
  locale: string
}

/** The languages that can be chosen. German is the source of the texts, and has no catalog. */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'en', name: 'English', locale: 'en-GB' }
]

/** The language of the texts as they are written in the code. */
export const SOURCE_LANGUAGE = 'de'

/** What a text is translated into when a language has nothing for it. */
const FALLBACK_LANGUAGE = 'en'

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
export type CatalogEntry = string | Partial<Record<PluralCategory, string>>
export type Catalog = Record<string, CatalogEntry>

/** The catalogs, by language. */
export const CATALOGS: Record<string, Catalog> = { en: en as Catalog }

let current: string = SOURCE_LANGUAGE
let chosen = 'system'
const listeners = new Set<() => void>()

/** The language that is in force. */
export const language = {
  get code(): string {
    return current
  },
  /** The locale for dates and numbers. */
  get locale(): string {
    return LANGUAGES.find((candidate) => candidate.code === current)?.locale ?? 'en-GB'
  },
  /** What the user chose: a language code, or `system` for the language of the telephone. */
  get choice(): string {
    return chosen
  },
  /** Puts a choice in force: the language it names, or the system's. */
  apply(choice: string, systemLocales: readonly string[] = systemLanguages()): void {
    chosen = choice
    current = resolveLanguage(choice, systemLocales)
    listeners.forEach((listener) => listener())
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}

export type Params = Record<string, string | number>

/** Puts the values where the text has `{name}`. A placeholder that has no value is left as it is, which is how a mistake is seen. */
function fill(text: string, params?: Params): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}

/** The entry for a key in the chain of languages: the one in force, then English. The source language has no catalog. */
function entryFor(key: string): CatalogEntry | undefined {
  if (current !== SOURCE_LANGUAGE) {
    const own = CATALOGS[current]?.[key]
    if (own !== undefined) return own
    return CATALOGS[FALLBACK_LANGUAGE]?.[key]
  }
  return undefined
}

/**
 * A text in the language in force. `text` is the German text as it is written in the code, with `{name}` where something is put in, and is what is shown
 * when there is nothing better. Put the words of a sentence in one call and not in pieces: the order of words is the translation's to change.
 */
export function t(text: string, params?: Params): string {
  const entry = entryFor(text)
  return fill(typeof entry === 'string' ? entry : text, params)
}

/** Marks a text that is written down now and shown later, such as the label of a choice in a constant: it is the same text, and is shown with `t(label)`. */
export function msg(text: string): string {
  return text
}

/** The plural category of a number in the language in force, with the rule of English where the platform has no rules of its own. */
function categoryOf(count: number): PluralCategory {
  try {
    return new Intl.PluralRules(language.locale).select(count) as PluralCategory
  } catch {
    return count === 1 ? 'one' : 'other'
  }
}

/**
 * A text with a number in it, in the form that the number takes: `one` for what the language writes for one (or for what it counts like one), `other` otherwise,
 * in the German of the code; `{count}` is the number. A catalog gives the forms its language has (`one`, `few`, `many` and so on) for the key `one|other`.
 */
export function tn(count: number, one: string, other: string, params?: Params): string {
  const category = categoryOf(count)
  const entry = entryFor(`${one}|${other}`)
  const own = entry !== undefined && typeof entry !== 'string' ? (entry[category] ?? entry.other) : undefined
  const text = own ?? (category === 'one' ? one : other)
  return fill(text, { count, ...params })
}

/**
 * The language to use for a choice and what the system says. `choice` is a language code or `system`. The system's languages are tried in order, each by its first
 * part (`de-AT` is `de`); when none is one of ours English is used, which is what most people can read.
 */
export function resolveLanguage(choice: string, systemLocales: readonly string[]): string {
  if (choice !== 'system' && LANGUAGES.some((candidate) => candidate.code === choice)) return choice
  for (const locale of systemLocales) {
    const base = locale.split(/[-_]/)[0].toLowerCase()
    if (LANGUAGES.some((candidate) => candidate.code === base)) return base
  }
  return FALLBACK_LANGUAGE
}

/** The languages the telephone is set to, the first being the one it prefers. */
export function systemLanguages(): string[] {
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale]
  } catch {
    return []
  }
}

const NAME = 'language'

/** What the user chose: a language code, or `system` which is until they choose. */
export async function loadLanguageChoice(db: SqlDb): Promise<string> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', NAME)
  if (!row) return 'system'
  try {
    const choice = (JSON.parse(row.value) as { choice?: unknown } | null)?.choice
    return typeof choice === 'string' && (choice === 'system' || LANGUAGES.some((candidate) => candidate.code === choice)) ? choice : 'system'
  } catch {
    return 'system'
  }
}

export async function saveLanguageChoice(db: SqlDb, choice: string): Promise<string> {
  await db.run(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    NAME,
    JSON.stringify({ choice })
  )
  return choice
}
