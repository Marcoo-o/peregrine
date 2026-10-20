import { describe, expect, it } from 'vitest'
import { decideLink } from './linkGuard'

const none = { links: [], known: [] as string[] }

describe('what is done with a link that was tapped', () => {
  it('is opened at once when nothing is wrong with it', () => {
    expect(decideLink('https://example.net/page', none.links, none.known)).toEqual({ action: 'open', url: 'https://example.net/page' })
  })

  it('is asked about first when it does not lead where it reads, by the text it had on the page', () => {
    const decision = decideLink(
      'https://evil.test/login',
      [{ href: 'https://evil.test/login', text: 'https://paypal.com/login' }],
      []
    )
    expect(decision.action).toBe('confirm')
    if (decision.action !== 'confirm') return
    expect(decision.analysis.displayHost).toBe('evil.test')
    expect(decision.analysis.findings.map((finding) => finding.risk)).toEqual(['textMismatch'])
  })

  it('is asked about first when the address itself is built to be misread, with no text to compare', () => {
    const decision = decideLink('https://www.example.net@evil.test/x', [], [])
    expect(decision.action).toBe('confirm')
  })

  it('is asked about first when it looks like a domain the user has addresses in', () => {
    expect(decideLink('https://examp1e.org/x', [], ['example.org']).action).toBe('confirm')
  })

  it('is told by the first link of the page that has the same address', () => {
    const decision = decideLink(
      'https://evil.test/a',
      [
        { href: 'https://evil.test/a', text: 'read more' },
        { href: 'https://evil.test/a', text: 'https://bank.example/' }
      ],
      []
    )
    expect(decision.action).toBe('open')
  })

  it('opens a telephone number, and does nothing with a mail address, which the application writes to itself', () => {
    expect(decideLink('tel:+491234', [], [])).toEqual({ action: 'open', url: 'tel:+491234' })
    expect(decideLink('mailto:a@example.net', [], [])).toEqual({ action: 'ignore' })
  })

  it('does nothing with an address of any other kind, which is how a page reaches into the phone', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///data/data/com.peregrinemobile/databases/x',
      'content://com.peregrinemobile.provider/x',
      'intent://scan/#Intent;scheme=zxing;end',
      'data:text/html,<p>x</p>',
      'sms:123',
      'about:blank',
      '',
      '/relative/path'
    ]) {
      expect(decideLink(url, [], [])).toEqual({ action: 'ignore' })
    }
  })

  it('is not fooled by capital letters in the kind of address', () => {
    expect(decideLink('HTTPS://example.net/', [], []).action).toBe('open')
    expect(decideLink('JavaScript:alert(1)', [], [])).toEqual({ action: 'ignore' })
  })
})
