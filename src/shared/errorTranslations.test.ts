import { describe, expect, it } from 'vitest'
import { ERROR_CODES, isAppErrorCode } from '@peregrine/core/errorText'
import de from '../renderer/src/i18n/locales/de.json'
import en from '../renderer/src/i18n/locales/en.json'

// The codes are portable, the sentences that say them are the desktop window's. So this is the
// one test of that file that has to live outside the package.
/**
 * The one that keeps the whole thing honest: a code without a translation would reach the user
 * as the literal string `errors.notConnected`, which is worse than the English sentence it
 * replaced.
 */
describe('every code is translated', () => {
  const locales = { de, en } as Record<string, { errors?: Record<string, string> }>

  for (const [language, bundle] of Object.entries(locales)) {
    it(`${language} has a text for all ${ERROR_CODES.length} codes`, () => {
      const missing = ERROR_CODES.filter((code) => !bundle.errors?.[code])
      expect(missing).toEqual([])
    })

    it(`${language} has no text for a code that no longer exists`, () => {
      const extra = Object.keys(bundle.errors ?? {}).filter((key) => !isAppErrorCode(key))
      expect(extra).toEqual([])
    })
  }

  // A detail that never reaches its sentence would leave a gap where the folder name belongs.
  it('places the detail in every text that carries one', () => {
    for (const code of ['mailboxOpenFailed', 'noPublicKeyFor', 'keyserverRejected'] as const) {
      expect(de.errors[code]).toContain('{{detail}}')
      expect(en.errors[code]).toContain('{{detail}}')
    }
  })
})
