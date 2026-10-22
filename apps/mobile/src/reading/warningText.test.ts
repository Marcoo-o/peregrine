import { describe, expect, it } from 'vitest'
import { analyzeLink, analyzeSender } from '@peregrine/core/linkSafety'
import { assessSpam } from '@peregrine/core/spamScore'
import { authFailedText, linkFindingText, senderFindingText, spamText, trackingPixelsText } from './warningText'

describe('what is said about a link', () => {
  it('names what is wrong, and says it with the thing that was found', () => {
    const [finding] = analyzeLink('https://evil.test/x', 'https://paypal.com/login').findings
    expect(linkFindingText(finding)).toEqual({
      title: 'Text und Ziel stimmen nicht überein',
      detail: 'Der sichtbare Text nennt paypal.com → evil.test.'
    })
  })

  it('has words for a link with a hidden destination', () => {
    const [finding] = analyzeLink('https://www.example.net@evil.test/x').findings
    expect(linkFindingText(finding).title).toBe('Echtes Ziel hinter dem @')
    expect(linkFindingText(finding).detail).toContain('„evil.test"')
  })
})

describe('what is said about a sender', () => {
  it('names what is wrong and shows what was found', () => {
    const [finding] = analyzeSender('service@bank.example', 'phish@attacker.test')
    expect(senderFindingText(finding)).toEqual({
      title: 'Angezeigter Name nennt eine andere Adresse',
      detail: 'service@bank.example → phish@attacker.test'
    })
  })
})

describe('what is said about the checks of the sender', () => {
  it('says what each of them means', () => {
    expect(authFailedText('dmarc').name).toBe('DMARC')
    expect(authFailedText('spf').text).toContain('nicht eingetragen')
    expect(authFailedText('dkim').text).toContain('Signatur')
  })
})

describe('what is said about the verdict of the spam filter', () => {
  it('says spam when the server said so, and borderline when it was in doubt', () => {
    const spam = assessSpam({ 'x-spamd-result': 'default: True [16.00 / 15.00]; FORGED_SENDER(5.00)[]' })!
    expect(spamText(spam)).toMatchObject({ banner: 'Ihr Mailserver hat diese Nachricht als Spam eingestuft', source: 'Rspamd' })
    const borderline = assessSpam({ 'x-spamd-result': 'default: False [9.00 / 15.00]; X(5.00)[]' })!
    expect(spamText(borderline).banner).toBe('Ihr Mailserver fand diese Nachricht grenzwertig')
  })
})

describe('what is said about tracking pixels', () => {
  it('is one sentence for one and another for several', () => {
    expect(trackingPixelsText(1).banner).toBe('Diese Nachricht enthält ein Zählpixel')
    expect(trackingPixelsText(3).banner).toBe('Diese Nachricht enthält 3 Zählpixel')
    expect(trackingPixelsText(3).detail).toContain('3 unsichtbare Bilder')
  })
})
