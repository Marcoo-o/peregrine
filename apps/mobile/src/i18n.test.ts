import { afterEach, describe, expect, it } from 'vitest'
import { appHarness } from './testing/appHarness'
import {
  CATALOGS,
  LANGUAGES,
  SOURCE_LANGUAGE,
  language,
  loadLanguageChoice,
  resolveLanguage,
  saveLanguageChoice,
  t,
  tn,
  type CatalogEntry
} from './i18n'

type Finder = { usedKeys: () => Set<string>; scanAll: () => Record<string, unknown[]> }
const finder = (async () => (await import('../../../scripts/mobile-strings.mjs' as string)) as Finder)()

const placeholders = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
const forms = (entry: CatalogEntry): string[] => (typeof entry === 'string' ? [entry] : Object.values(entry).filter((x): x is string => typeof x === 'string'))

afterEach(() => language.apply(SOURCE_LANGUAGE, []))

describe('the catalogs', () => {
  const languages = LANGUAGES.filter((candidate) => candidate.code !== SOURCE_LANGUAGE)

  it('have a catalog for each language that can be chosen, other than German', () => {
    expect(Object.keys(CATALOGS).sort()).toEqual(languages.map((candidate) => candidate.code).sort())
  })

  for (const { code } of languages) {
    describe(code, () => {
      it('translates every text of the code, and nothing that is not in it any more', async () => {
        const used = (await finder).usedKeys()
        const have = new Set(Object.keys(CATALOGS[code]))
        expect([...used].filter((key) => !have.has(key)).sort()).toEqual([])
        expect([...have].filter((key) => !used.has(key)).sort()).toEqual([])
      })

      it('keeps the values that are put into a text, in each of its forms', () => {
        const wrong: string[] = []
        for (const [key, entry] of Object.entries(CATALOGS[code])) {
          const [one, other] = key.split('|')
          // A plural text may leave out {count} in the singular, as the German does; every other value must be there.
          const wanted = placeholders(other === undefined ? one : `${one} ${other}`).filter((name) => name !== 'count')
          for (const form of forms(entry)) {
            const got = placeholders(form).filter((name) => name !== 'count')
            if (got.some((name) => !wanted.includes(name)) || wanted.some((name) => !got.includes(name) && typeof entry === 'string')) wrong.push(`${key} -> ${form}`)
          }
        }
        expect(wrong).toEqual([])
      })

      it('has no empty translation', () => {
        expect(Object.entries(CATALOGS[code]).filter(([, entry]) => forms(entry).some((form) => form.trim() === ''))).toEqual([])
      })
    })
  }
})

describe('t and tn', () => {
  it('give the text of the code in German', () => {
    expect(t('Speichern')).toBe('Speichern')
    expect(t('Gespeichert: {name}', { name: 'a.txt' })).toBe('Gespeichert: a.txt')
    expect(tn(1, '{count} Nachricht', '{count} Nachrichten')).toBe('1 Nachricht')
    expect(tn(3, '{count} Nachricht', '{count} Nachrichten')).toBe('3 Nachrichten')
  })

  it('give the translation in another language, with the values put in', () => {
    language.apply('en', [])
    expect(t('Speichern')).toBe('Save')
    expect(t('Gespeichert: {name}', { name: 'a.txt' })).toBe('Saved: a.txt')
    expect(tn(1, '{count} Nachricht', '{count} Nachrichten')).toBe('1 message')
    expect(tn(0, '{count} Nachricht', '{count} Nachrichten')).toBe('0 messages')
    expect(tn(2, '{count} Nachricht', '{count} Nachrichten')).toBe('2 messages')
  })

  it('show the text of the code where a language has nothing for it, and leave a value that is missing as it is', () => {
    language.apply('en', [])
    expect(t('Ein Text, den es nicht gibt')).toBe('Ein Text, den es nicht gibt')
    expect(t('Gespeichert: {name}')).toBe('Saved: {name}')
  })

  it('fall back to the other form where the catalog has none for the number', () => {
    CATALOGS.en['A|B'] = { other: 'many {count}' }
    try {
      language.apply('en', [])
      expect(tn(1, 'A', 'B')).toBe('many 1')
    } finally {
      delete CATALOGS.en['A|B']
    }
  })
})

describe('the language that is used', () => {
  it('is the one chosen, or else the first of the telephone that is one of ours, or else English', () => {
    expect(resolveLanguage('de', ['en-GB'])).toBe('de')
    expect(resolveLanguage('system', ['fr-FR', 'de-AT', 'en'])).toBe('de')
    expect(resolveLanguage('system', ['en_US'])).toBe('en')
    expect(resolveLanguage('system', ['fr-FR'])).toBe('en')
    expect(resolveLanguage('system', [])).toBe('en')
    expect(resolveLanguage('xx', ['de'])).toBe('de')
  })

  it('tells what the dates and numbers are written in', () => {
    language.apply('de', [])
    expect(language.locale).toBe('de-DE')
    language.apply('en', [])
    expect(language.locale).toBe('en-GB')
  })

  it('notifies those who show texts when it changes', () => {
    let calls = 0
    const stop = language.subscribe(() => calls++)
    language.apply('en', [])
    language.apply('de', [])
    stop()
    language.apply('en', [])
    expect(calls).toBe(2)
  })

  it('is kept, and a stored choice that is not one of ours is the telephone', async () => {
    const t = await appHarness()
    expect(await loadLanguageChoice(t.db)).toBe('system')
    await saveLanguageChoice(t.db, 'en')
    expect(await loadLanguageChoice(t.db)).toBe('en')
    await saveLanguageChoice(t.db, 'tlh')
    expect(await loadLanguageChoice(t.db)).toBe('system')
  })
})

describe('choosing the language in the settings', () => {
  it('puts it in force at once, keeps it, and shows the settings in it', async () => {
    const t = await appHarness()
    await t.app.settings.show()
    await t.app.settings.setLanguage('en')
    expect(language.code).toBe('en')
    expect(language.choice).toBe('en')
    expect(await loadLanguageChoice(t.db)).toBe('en')
    await t.app.settings.setLanguage('system')
    expect(language.choice).toBe('system')
  })

  it('is read again when the application starts', async () => {
    const t = await appHarness()
    await saveLanguageChoice(t.db, 'en')
    await t.app.start()
    expect(language.code).toBe('en')
  })
})

describe('the code', () => {
  it('has no fixed text left that is not in the baseline', async () => {
    const counts = Object.fromEntries(Object.entries((await finder).scanAll()).map(([file, found]) => [file, found.length]))
    const baseline = (await import('../../../scripts/mobile-strings-baseline.json')).default as Record<string, number>
    const more = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0))
    expect(more).toEqual([])
  })
})
