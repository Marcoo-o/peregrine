import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import pt from './locales/pt.json'

/**
 * Every language has to carry every key of the English one.
 *
 * i18next falls back silently, so a missing key does not break anything: it shows the English
 * sentence in the middle of a Spanish window and nobody notices until a user does. And a
 * placeholder dropped in translation is worse still, because "{{count}} mensajes" arriving as
 * "mensajes" reads as finished text while having lost the number.
 */

type Tree = Record<string, unknown>

function flatten(tree: Tree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value as Tree, path, out)
    else out[path] = String(value)
  }
  return out
}

/** The interpolations of one string, sorted, so order of appearance does not matter. */
function placeholders(text: string): string[] {
  return (text.match(/\{\{\w+\}\}/g) ?? []).sort()
}

const english = flatten(en as Tree)
const translations: Record<string, Tree> = { de, es, fr, pt }

describe.each(Object.keys(translations))('%s.json', (language) => {
  const translated = flatten(translations[language])

  it('has every key the English file has', () => {
    const missing = Object.keys(english).filter((key) => !(key in translated))
    expect(missing).toEqual([])
  })

  it('has no key the English file does not have', () => {
    const extra = Object.keys(translated).filter((key) => !(key in english))
    expect(extra).toEqual([])
  })

  it('keeps every placeholder of every string', () => {
    const wrong = Object.keys(english)
      .filter((key) => key in translated)
      .filter(
        (key) =>
          placeholders(english[key]).join() !== placeholders(translated[key]).join()
      )
    expect(wrong).toEqual([])
  })
})
