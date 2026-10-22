import { describe, expect, it } from 'vitest'
import { readable } from '../testing/readable'
import { assessMessage, assessPage, isOwnAddress, knownDomainsOf, linksInText } from './assessment'

describe('what is known of a message before it is shown', () => {
  it('has nothing to say about an ordinary message', () => {
    expect(assessMessage(readable(), [], false)).toEqual({ spam: null, failedAuth: [], sender: [], firstContact: false })
  })

  it('has the verdict of the server, when it found the message borderline or spam, and not when it found it clean', () => {
    const spam = assessMessage(readable({ headers: { 'x-spamd-result': 'default: True [16.00 / 15.00]; FORGED_SENDER(5.00)[]' } }), [], false)
    expect(spam.spam).toMatchObject({ verdict: 'spam', source: 'rspamd' })
    expect(spam.spam?.symbols[0].name).toBe('FORGED_SENDER')

    const clean = assessMessage(readable({ headers: { 'x-spamd-result': 'default: False [1.00 / 15.00]; ARC_NA(0.00)[]' } }), [], false)
    expect(clean.spam).toBeNull()
  })

  it('has the checks of the sender that failed, and only those', () => {
    const results = assessMessage(
      readable({ headers: { 'authentication-results': 'mx.example.org; spf=pass; dkim=pass; dmarc=fail action=none' } }),
      [],
      false
    )
    expect(results.failedAuth).toEqual(['dmarc'])
  })

  it('finds a sender whose name claims another address, and a reply that would go elsewhere', () => {
    const message = readable({
      from: '"service@bank.example" <phish@attacker.test>',
      replyTo: 'collect@elsewhere.test'
    })
    const risks = assessMessage(message, [], false).sender.map((finding) => finding.risk)
    expect(risks).toEqual(['nameContainsOtherAddress', 'replyToMismatch'])
  })

  it('finds a sender who looks like somebody the user writes to', () => {
    const message = readable({ from: 'Support <help@examp1e.org>' })
    const found = assessMessage(message, ['example.org'], false).sender
    expect(found.map((finding) => finding.risk)).toContain('lookalikeDomain')
  })

  it('does not take the user own domain for a lookalike of itself', () => {
    expect(assessMessage(readable({ from: 'Alex <alex@example.org>' }), ['example.org'], false).sender).toEqual([])
  })
})

describe('the domains of the user', () => {
  it('are those of the addresses of the accounts, once each and in lower case', () => {
    const accounts = [{ emailAddress: 'a@Example.org' }, { emailAddress: 'b@example.org' }, { emailAddress: 'c@example.net' }, { emailAddress: '' }]
    expect(knownDomainsOf(accounts)).toEqual(['example.org', 'example.net'])
  })
})

describe('what is known of a message once its page has been read', () => {
  it('has the links that do not lead where they read, one for each destination', () => {
    const page = assessPage(
      {
        links: [
          { href: 'https://evil.test/login', text: 'https://paypal.com/login' },
          { href: 'https://evil.test/login', text: 'https://paypal.com/login' },
          { href: 'https://example.net/page', text: 'a page' }
        ],
        images: []
      },
      []
    )
    expect(page.links).toHaveLength(1)
    expect(page.links[0]).toMatchObject({ href: 'https://evil.test/login' })
    expect(page.links[0].findings[0].risk).toBe('textMismatch')
  })

  it('looks only at web links', () => {
    const page = assessPage({ links: [{ href: 'mailto:a@example.net', text: 'https://paypal.com' }, { href: 'tel:123', text: 'x' }], images: [] }, [])
    expect(page.links).toEqual([])
  })

  it('counts the images that exist to say the message was opened, by their size or their style', () => {
    const page = assessPage(
      {
        links: [],
        images: [
          { src: 'https://track.example.net/a.gif', width: '1', height: '1', style: '' },
          { src: 'https://track.example.net/b.gif', width: null, height: null, style: 'width:0;height:0' },
          { src: 'https://news.example.net/banner.png', width: '600', height: '200', style: '' },
          { src: 'data:image/gif;base64,R0lG', width: '1', height: '1', style: '' },
          { src: 'cid:logo', width: '1', height: '1', style: '' }
        ]
      },
      []
    )
    expect(page.trackingPixels).toBe(2)
  })
})

describe('the links of a message that has no page', () => {
  it('are the addresses in its text, without the punctuation that ends a sentence', () => {
    const links = linksInText('See https://example.net/a, and (https://example.org/b). Also http://a.test/c!')
    expect(links.map((link) => link.href)).toEqual(['https://example.net/a', 'https://example.org/b', 'http://a.test/c'])
    expect(links.every((link) => link.text === '')).toBe(true)
  })

  it('says whether the message is the first from its sender, as it is told', () => {
    expect(assessMessage(readable(), [], true).firstContact).toBe(true)
  })
})

describe("whether an address is the user's own", () => {
  const accounts = [{ emailAddress: 'Work@Example.org' }, { emailAddress: 'home@example.org' }]

  it('is any of the addresses of the accounts, in whatever case', () => {
    expect(isOwnAddress(accounts, 'work@example.org')).toBe(true)
    expect(isOwnAddress(accounts, ' HOME@example.org ')).toBe(true)
  })

  it('is not another address, nor none, nor an account that has no address', () => {
    expect(isOwnAddress(accounts, 'anna@example.net')).toBe(false)
    expect(isOwnAddress(accounts, '')).toBe(false)
    expect(isOwnAddress([{ emailAddress: '' }], '')).toBe(false)
  })
})
