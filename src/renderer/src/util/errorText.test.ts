import { beforeAll, describe, expect, it } from 'vitest'
import i18next from '@renderer/i18n'
import { appError } from '@peregrine/core/errorText'
import { errorText } from './errorText'

/**
 * Against the real i18next instance the application uses, not a stub: the point of the whole
 * change is that a German interface stops showing English sentences, and a stub would agree
 * with any wiring at all. Including one that hands back the bare key.
 */
describe('errorText', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('de')
  })

  it('turns a code into a German sentence', () => {
    expect(errorText(appError('notConnected'))).toBe(
      'Das Konto ist gerade nicht mit dem Server verbunden.'
    )
  })

  it('puts the detail into the sentence', () => {
    expect(errorText(appError('mailboxOpenFailed', 'INBOX/Archiv'))).toContain('INBOX/Archiv')
  })

  it('translates a code that arrived through IPC', () => {
    const arrived = new Error("Error invoking remote method 'folders:rename': Error: notConnected")
    expect(errorText(arrived)).toBe('Das Konto ist gerade nicht mit dem Server verbunden.')
  })

  // Never the key itself: `errors.notConnected` in a red line would be a step backwards from
  // the English sentence it replaced.
  it('never shows a translation key', () => {
    for (const text of [errorText(appError('wrongPassphrase')), errorText(appError('trashUnavailable'))]) {
      expect(text.startsWith('errors.')).toBe(false)
    }
  })

  it('shows an untranslatable failure without the IPC scaffolding', () => {
    const arrived = new Error("Error invoking remote method 'x': Error: socket hang up")
    expect(errorText(arrived)).toBe('socket hang up')
  })

  it('follows the chosen language', async () => {
    await i18next.changeLanguage('en')
    expect(errorText(appError('trashUnavailable'))).toBe('This account has no trash folder.')
    await i18next.changeLanguage('de')
    expect(errorText(appError('trashUnavailable'))).toBe('Dieses Konto hat keinen Papierkorb.')
  })
})
