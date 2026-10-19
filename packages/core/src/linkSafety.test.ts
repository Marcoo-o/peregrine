import { describe, expect, it } from 'vitest'
import {
  analyzeLink,
  analyzeSender,
  decodeHost,
  decodePunycode,
  editDistance,
  lookalikeOf,
  invisibleCharactersIn,
  mixedScriptsIn,
  type LinkRisk,
  type SenderRisk
} from './linkSafety'

const risks = (href: string, text?: string): LinkRisk[] =>
  analyzeLink(href, text).findings.map((f) => f.risk)

const senderRisks = (name: string, address: string, replyTo?: string): SenderRisk[] =>
  analyzeSender(name, address, replyTo).map((f) => f.risk)

describe('decodePunycode', () => {
  it('decodes a German domain', () => {
    expect(decodePunycode('xn--mnchen-3ya')).toBe('münchen')
  })

  it('decodes a label that is entirely non-Latin', () => {
    expect(decodePunycode('xn--80ak6aa92e')).toBe('аррӏе')
  })

  it('decodes an emoji label', () => {
    expect(decodePunycode('xn--ls8h')).toBe('💩')
  })

  it('leaves a plain label alone', () => {
    expect(decodePunycode('example')).toBeNull()
  })

  it('refuses malformed input instead of inventing a result', () => {
    expect(decodePunycode('xn--')).toBeNull()
    expect(decodePunycode('xn--!!!')).toBeNull()
  })
})

describe('decodeHost', () => {
  it('decodes only the encoded labels', () => {
    expect(decodeHost('xn--mnchen-3ya.example.com')).toBe('münchen.example.com')
  })

  it('passes an ordinary host through unchanged', () => {
    expect(decodeHost('mail.example.com')).toBe('mail.example.com')
  })
})

describe('mixedScriptsIn', () => {
  it('catches a single Cyrillic letter hidden among Latin ones', () => {
    // "аpple.com". The first letter is Cyrillic U+0430, indistinguishable on screen.
    expect(mixedScriptsIn('аpple.com')).toEqual(['cyrillic', 'latin'])
  })

  it('accepts a domain written entirely in one alphabet', () => {
    expect(mixedScriptsIn('москва.рф')).toEqual([])
  })

  // A Cyrillic name with a Latin suffix is an ordinary domain, not a forgery: the mixing
  // has to happen inside one label to be a lookalike.
  it('does not flag a Cyrillic name under a Latin suffix', () => {
    expect(mixedScriptsIn('москва.shop')).toEqual([])
  })

  it('leaves alphabets alone that nobody confuses with Latin', () => {
    expect(mixedScriptsIn('東京shop.jp')).toEqual([])
    expect(mixedScriptsIn('קניות.co.il')).toEqual([])
  })

  it('accepts accented Latin as Latin', () => {
    expect(mixedScriptsIn('müller-söhne.de')).toEqual([])
  })

  it('catches Greek mixed into Latin', () => {
    expect(mixedScriptsIn('gοogle.com')).toEqual(['latin', 'greek'])
  })
})

describe('invisibleCharactersIn', () => {
  it('finds a zero-width space', () => {
    expect(invisibleCharactersIn('pay​pal.com')).toEqual(['U+200B'])
  })

  it('finds a right-to-left override', () => {
    expect(invisibleCharactersIn('rechnung‮gpj.exe')).toEqual(['U+202E'])
  })

  it('says nothing about ordinary text', () => {
    expect(invisibleCharactersIn('Rechnung März 2026')).toEqual([])
  })
})

describe('analyzeLink', () => {
  it('has nothing to say about an ordinary link', () => {
    expect(risks('https://example.com/rechnung')).toEqual([])
  })

  it('reports an encoded lookalike domain and what it says', () => {
    const analysis = analyzeLink('https://xn--80ak6aa92e.com/login')
    expect(analysis.findings.map((f) => f.risk)).toContain('punycode')
    expect(analysis.displayHost).toBe('аррӏе.com')
  })

  it('reports the host hidden behind an @', () => {
    expect(risks('https://www.paypal.com@evil.example/login')).toContain('userInfo')
  })

  it('reports a bare IP address', () => {
    expect(risks('http://203.0.113.9/update')).toContain('ipAddressHost')
  })

  it('reports text naming one host while pointing at another', () => {
    expect(risks('https://evil.example/login', 'paypal.com')).toContain('textMismatch')
  })

  it('accepts a subdomain of the host the text names', () => {
    expect(risks('https://login.example.com', 'example.com')).not.toContain('textMismatch')
  })

  it('ignores the difference between www and the bare domain', () => {
    expect(risks('https://www.example.com/x', 'example.com')).not.toContain('textMismatch')
  })

  // "Click here" pointing somewhere is normal writing, not a mismatch.
  it('stays quiet when the text does not claim to be an address', () => {
    expect(risks('https://evil.example/login', 'Jetzt bestätigen')).toEqual([])
  })

  it('reports an invisible character inside the address', () => {
    expect(risks('https://pay​pal.com')).toContain('invisibleCharacters')
  })

  it('returns no findings for something that is not a URL at all', () => {
    expect(analyzeLink('nicht mal ansatzweise eine url').findings).toEqual([])
  })
})

describe('analyzeSender', () => {
  it('has nothing to say about an ordinary sender', () => {
    expect(senderRisks('Anna Meier', 'anna@example.com')).toEqual([])
  })

  it('reports a display name claiming a different address', () => {
    expect(senderRisks('service@hausbank.test', 'zufall@fremdanbieter.example')).toContain(
      'nameContainsOtherAddress'
    )
  })

  it('accepts a display name repeating the real address', () => {
    expect(senderRisks('anna@example.com', 'anna@example.com')).toEqual([])
  })

  it('reports a reply that would go to another domain', () => {
    expect(senderRisks('Rechnung', 'billing@example.com', 'kasse@fremdanbieter.example')).toContain(
      'replyToMismatch'
    )
  })

  it('accepts a reply-to within the same domain', () => {
    expect(senderRisks('Support', 'noreply@example.com', 'support@example.com')).toEqual([])
  })

  it('reports a lookalike sender domain', () => {
    expect(senderRisks('Bank', 'info@ѕparkasse.de')).toContain('mixedScript')
  })
})

describe('editDistance', () => {
  it('counts a single substitution', () => {
    expect(editDistance('paypal', 'paypa1')).toBe(1)
  })

  it('gives up once the limit is passed instead of counting further', () => {
    expect(editDistance('abc', 'xyzxyz', 2)).toBeGreaterThan(2)
  })

  it('is zero for identical strings', () => {
    expect(editDistance('example.com', 'example.com')).toBe(0)
  })
})

describe('lookalikeOf', () => {
  const known = ['hausbank.test', 'example.com', 'post.de']

  it('says nothing about a domain that is in the list', () => {
    expect(lookalikeOf('hausbank.test', known)).toBeNull()
  })

  it('treats a subdomain of a known domain as the real thing', () => {
    expect(lookalikeOf('banking.hausbank.test', known)).toBeNull()
  })

  it('catches a swapped character', () => {
    expect(lookalikeOf('hausbamk.test', known)).toBe('hausbank.test')
  })

  it('catches another suffix on the same name', () => {
    expect(lookalikeOf('hausbank.com', known)).toBe('hausbank.test')
  })

  // The shape no character-level check would catch: the real name is there, spelled right,
  // but the domain that governs it is someone else's.
  it('catches the name moved into a foreign domain', () => {
    expect(lookalikeOf('hausbank-test.com', known)).toBe('hausbank.test')
    expect(lookalikeOf('login-hausbank.net', known)).toBe('hausbank.test')
    expect(lookalikeOf('hausbank.test.abrechnung.net', known)).toBe('hausbank.test')
  })

  // "post.de" and "host.de" are one edit apart and have nothing to do with each other.
  it('does not flag short names that merely collide', () => {
    expect(lookalikeOf('host.de', known)).toBeNull()
  })

  it('says nothing when there is nothing to compare against', () => {
    expect(lookalikeOf('irgendwas.example', [])).toBeNull()
  })

  it('is not confused by a two-part suffix', () => {
    expect(lookalikeOf('example.co.uk', ['example.co.uk'])).toBeNull()
    expect(lookalikeOf('shop.example.co.uk', ['example.co.uk'])).toBeNull()
    expect(lookalikeOf('example.com', ['example.co.uk'])).toBe('example.co.uk')
  })

  // A person's own domain is the one they correspond with most, and the contact is often at a
  // host below it. Mail from the domain itself, or from another host under it, is the same owner.
  describe('under one registered domain', () => {
    const own = ['mail.example.org']

    it('treats the parent of a known host as the same owner', () => {
      expect(lookalikeOf('example.org', own)).toBeNull()
    })

    it('treats a sibling host as the same owner', () => {
      expect(lookalikeOf('news.example.org', own)).toBeNull()
      expect(lookalikeOf('a.b.example.org', own)).toBeNull()
    })

    // Nobody but the owner can create a name below example.org, so the trust ends exactly there.
    it('still catches the name in a domain that belongs to somebody else', () => {
      expect(lookalikeOf('example.org.attacker.test', own)).toBe('mail.example.org')
      expect(lookalikeOf('example-login.net', own)).toBe('mail.example.org')
      expect(lookalikeOf('evilexample.org', own)).toBe('mail.example.org')
      expect(lookalikeOf('mail.example.org.attacker.test', own)).toBe('mail.example.org')
    })

    it('still catches another suffix on the same name', () => {
      expect(lookalikeOf('example.net', own)).toBe('mail.example.org')
    })

    it('does not warn a sender about their own domain', () => {
      expect(analyzeSender('Alex', 'alex@example.org', null, own)).toEqual([])
    })
  })
})
