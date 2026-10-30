import { describe, expect, it } from 'vitest'
import type { PageLink } from './assessment'
import { decideLink, normalised } from './linkGuard'

/** A link of the page, as the page reports it. */
const link = (href: string, text = ''): PageLink => ({ href, text })

describe('what is done with a link that was tapped', () => {
  it('is opened at once when nothing is wrong with it', () => {
    const url = 'https://example.net/page'
    expect(decideLink(url, [link(url, 'a page')], [])).toEqual({ action: 'open', url })
  })

  it('is asked about first when it does not lead where it reads, by the text it had on the page', () => {
    const url = 'https://evil.test/login'
    const decision = decideLink(url, [link(url, 'https://paypal.com/login')], [])
    expect(decision.action).toBe('confirm')
    if (decision.action !== 'confirm') return
    expect(decision.analysis.displayHost).toBe('evil.test')
    expect(decision.analysis.findings.map((finding) => finding.risk)).toEqual(['textMismatch'])
  })

  it('is asked about first when the address itself is built to be misread, with no text to compare', () => {
    const url = 'https://www.example.net@evil.test/x'
    expect(decideLink(url, [link(url)], []).action).toBe('confirm')
  })

  it('is asked about first when it looks like a domain the user has addresses in', () => {
    const url = 'https://examp1e.org/x'
    expect(decideLink(url, [link(url)], ['example.org']).action).toBe('confirm')
  })

  it('is told by the first link of the page that has the same address', () => {
    const url = 'https://evil.test/a'
    expect(decideLink(url, [link(url, 'read more'), link(url, 'https://bank.example/')], []).action).toBe('open')
  })

  it('opens a telephone number, and does nothing with a mail address, which the application writes to itself', () => {
    expect(decideLink('tel:+491234', [link('tel:+491234')], [])).toEqual({ action: 'open', url: 'tel:+491234' })
    expect(decideLink('mailto:a@example.net', [link('mailto:a@example.net')], [])).toEqual({ action: 'ignore' })
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
      // not even when the page has a link that says so
      expect(decideLink(url, [link(url)], [])).toEqual({ action: 'ignore' })
    }
  })

  it('is not fooled by capital letters in the kind of address', () => {
    expect(decideLink('HTTPS://example.net/', [link('HTTPS://example.net/')], []).action).toBe('open')
    expect(decideLink('JavaScript:alert(1)', [link('JavaScript:alert(1)')], [])).toEqual({ action: 'ignore' })
  })
})

describe('a navigation that is not a tap on a link of the page', () => {
  // The view reports every navigation alike: a link that was followed, a form that was sent, a redirect, a
  // window that a page opens. Only the first is something the user did, and it leads to an address that a link
  // of the page has. What leads anywhere else is not opened, however harmless the address looks.
  it('is not opened, such as a form sent to an address that no link has', () => {
    expect(decideLink('https://probe.test/submit', [link('https://example.net/a')], [])).toEqual({ action: 'ignore' })
  })

  it('is not opened while the page has not said what its links are', () => {
    expect(decideLink('https://example.net/a', [], [])).toEqual({ action: 'ignore' })
  })

  it('is a tap on a link when the view spells the address of that link another way', () => {
    expect(decideLink('https://example.net/', [link('https://example.net')], []).action).toBe('open')
    expect(decideLink('https://EXAMPLE.net/a b', [link('https://example.net/a%20b')], []).action).toBe('open')
  })

  it('is not a tap on a link when only the start of the address is the same', () => {
    expect(decideLink('https://example.net/a?stolen=1', [link('https://example.net/a')], [])).toEqual({ action: 'ignore' })
  })
})

describe('the spellings of one address', () => {
  it('are one, whatever a browser changes in them', () => {
    expect(normalised('HTTPS://Example.NET')).toBe('https://example.net/')
    expect(normalised('https://example.net')).toBe(normalised('https://example.net/'))
    expect(normalised('https://example.net/a b?x=1')).toBe('https://example.net/a%20b?x=1')
    expect(normalised('https://example.net/a#top')).toBe('https://example.net/a')
    expect(normalised('tel:+491234')).toBe('tel:+491234')
    expect(normalised('TEL:+491234')).toBe('tel:+491234')
  })

  it('are two when anything that matters differs', () => {
    expect(normalised('https://example.net/a')).not.toBe(normalised('https://example.net/b'))
    expect(normalised('https://example.net/a?x=1')).not.toBe(normalised('https://example.net/a'))
    expect(normalised('https://example.net/a')).not.toBe(normalised('http://example.net/a'))
    expect(normalised('https://example.net/a')).not.toBe(normalised('https://example.org/a'))
  })

  it('leave what is not an address as it is', () => {
    expect(normalised('/relative/path')).toBe('/relative/path')
  })
})

describe('what is done with a link when the user chose how careful to be', () => {
  const bad = 'https://evil.test/login'
  const badText = 'https://paypal.com/login'
  const fine = 'https://example.net/page'

  it('is opened at once, though it looks wrong, when the check for that is off', () => {
    expect(decideLink(bad, [link(bad, badText)], [], { warnSuspicious: false, confirmAll: false })).toEqual({ action: 'open', url: bad })
  })

  it('is asked about even when nothing is wrong with it, when every link is to be asked about', () => {
    const decision = decideLink(fine, [link(fine, 'a page')], [], { warnSuspicious: true, confirmAll: true })
    expect(decision.action).toBe('confirm')
    if (decision.action === 'confirm') expect(decision.analysis.findings).toEqual([])
  })

  it('is asked about when every link is to be asked about, whether or not the check for the ones that look wrong is on', () => {
    expect(decideLink(fine, [link(fine)], [], { warnSuspicious: false, confirmAll: true }).action).toBe('confirm')
  })

  it('is still left alone when the page did not say it, whatever was chosen', () => {
    expect(decideLink(fine, [], [], { warnSuspicious: true, confirmAll: true })).toEqual({ action: 'ignore' })
    expect(decideLink('intent://x', [link('intent://x')], [], { warnSuspicious: true, confirmAll: true })).toEqual({ action: 'ignore' })
  })

  it('is a telephone number, which is not asked about', () => {
    expect(decideLink('tel:+4912345', [link('tel:+4912345')], [], { warnSuspicious: true, confirmAll: true })).toEqual({ action: 'open', url: 'tel:+4912345' })
  })
})
