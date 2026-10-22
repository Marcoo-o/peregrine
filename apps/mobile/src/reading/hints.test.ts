import { describe, expect, it } from 'vitest'
import { analyzeLink } from '@peregrine/core/linkSafety'
import { assessSpam } from '@peregrine/core/spamScore'
import { hintsFor } from './hints'

const calm = { spam: null, failedAuth: [], sender: [], firstContact: false }
const nothingOnPage = { links: [], trackingPixels: 0 }

const hints = (over: Partial<Parameters<typeof hintsFor>[0]> = {}) =>
  hintsFor({ assessment: calm, page: nothingOnPage, remoteImages: 0, showingImages: false, ...over })

describe('what a message has to say for itself', () => {
  it('is nothing for an ordinary message', () => {
    expect(hints()).toEqual([])
  })

  it('is nothing before the message is there to be looked at', () => {
    expect(hints({ assessment: undefined })).toEqual([])
  })

  it('has the verdict of the server first, with what it found', () => {
    const spam = assessSpam({ 'x-spamd-result': 'default: True [16.00 / 15.00]; FORGED_SENDER(5.00)[]; ODD(1.50)[]' })!
    const [first] = hints({ assessment: { ...calm, spam } })
    expect(first).toMatchObject({ id: 'spam', tone: 'danger', title: 'Ihr Mailserver hat diese Nachricht als Spam eingestuft' })
    expect(first.detail).toContain('Rspamd')
    expect(first.detail).toContain('FORGED_SENDER (5)')
    expect(first.detail).toContain('ODD (1.5)')
  })

  it('calls a message the server was in doubt about borderline, and says so less sharply', () => {
    const spam = assessSpam({ 'x-spamd-result': 'default: False [9.00 / 15.00]; X(5.00)[]' })!
    expect(hints({ assessment: { ...calm, spam } })[0]).toMatchObject({ id: 'spam', tone: 'warning' })
  })

  it('has one hint for the checks of the sender that failed, naming each', () => {
    const found = hints({ assessment: { ...calm, failedAuth: ['dmarc', 'spf'] } })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ id: 'auth', tone: 'danger', title: 'Der Server konnte den Absender dieser Nachricht nicht bestätigen' })
    expect(found[0].detail).toContain('DMARC')
    expect(found[0].detail).toContain('SPF')
    expect(found[0].detail).not.toContain('DKIM')
  })

  it('has a hint for each thing wrong with the sender', () => {
    const found = hints({
      assessment: {
        ...calm,
        sender: [
          { risk: 'nameContainsOtherAddress', detail: 'service@bank.example → phish@attacker.test' },
          { risk: 'replyToMismatch', detail: 'collect@elsewhere.test' }
        ]
      }
    })
    expect(found.map((hint) => [hint.id, hint.title])).toEqual([
      ['sender-nameContainsOtherAddress', 'Angezeigter Name nennt eine andere Adresse'],
      ['sender-replyToMismatch', 'Antworten gehen an eine andere Domain']
    ])
    expect(found[0].detail).toBe('service@bank.example → phish@attacker.test')
  })

  it('has one hint for the links that do not lead where they read, naming where they lead', () => {
    const links = [analyzeLink('https://evil.test/a', 'https://paypal.com/'), analyzeLink('https://www.example.net@other.test/x')]
    const [hint] = hints({ page: { links, trackingPixels: 0 } })
    expect(hint).toMatchObject({ id: 'links', tone: 'danger', title: 'Dieser Link führt woanders hin, als er aussieht' })
    expect(hint.detail).toContain('evil.test')
    expect(hint.detail).toContain('other.test')
  })

  it('says how many images count the opening of the message', () => {
    expect(hints({ page: { links: [], trackingPixels: 2 } })[0]).toMatchObject({ id: 'pixels', tone: 'info', title: 'Diese Nachricht enthält 2 Zählpixel' })
  })

  it('says that images were held back, and offers to show them, until they are shown', () => {
    expect(hints({ remoteImages: 3 })).toEqual([
      expect.objectContaining({ id: 'images', tone: 'info', title: 'Externe Bilder wurden zum Schutz Ihrer Privatsphäre blockiert.', action: 'showImages' })
    ])
    expect(hints({ remoteImages: 3, showingImages: true })).toEqual([])
  })

  it('tells a first message from an address, without alarm and without a thing to do about it', () => {
    expect(hints({ assessment: { ...calm, firstContact: true } })).toEqual([
      expect.objectContaining({ id: 'first-contact', tone: 'info', title: 'Erste Nachricht von dieser Adresse' })
    ])
  })

  it('keeps the order of the desktop: the server, the sender, the links, the images', () => {
    const spam = assessSpam({ 'x-spamd-result': 'default: True [16.00 / 15.00]; X(5.00)[]' })!
    const found = hints({
      assessment: { spam, failedAuth: ['spf'], sender: [{ risk: 'replyToMismatch', detail: 'a@b.test' }], firstContact: true },
      page: { links: [analyzeLink('https://evil.test/a', 'https://paypal.com/')], trackingPixels: 1 },
      remoteImages: 1
    })
    expect(found.map((hint) => hint.id)).toEqual(['spam', 'auth', 'sender-replyToMismatch', 'links', 'pixels', 'first-contact', 'images'])
  })
})
