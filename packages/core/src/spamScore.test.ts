import { describe, expect, it } from 'vitest'
import { assessSpam } from './spamScore'

/**
 * A real Rspamd verdict as mailcow writes it, with the recipient domain replaced.
 *
 * Kept whole rather than trimmed to the interesting part: the parser has to survive the
 * length, the nesting and the symbols that carry commas and equals signs inside their
 * brackets, and a shortened fixture would prove none of that.
 */
const RSPAMD =
  'default: False [9.76 / 15.00]; MIME_FROM_MX_NONE(4.00)[newsletter.example.com]; ' +
  'URIBL_GREY(2.50)[kmail-lists.example:url]; BAD_REP_POLICIES(2.00)[]; ' +
  'SUSPICIOUS_URL_IN_SUSPICIOUS_MESSAGE(1.00)[]; ' +
  'FORGED_SENDER(0.30)[marketing@newsletter.example.com,bounce-kl_27364891705=2@k3.newsletter.example.com]; ' +
  'IP_REPUTATION_HAM(-0.25)[asn: 14618(-0.21), country: US(-0.01), ip: 170.203.29.3(-0.03)]; ' +
  'R_PARTS_DIFFER(0.22)[60.8%]; ONCE_RECEIVED(0.20)[]; REPLYTO_MX_GOOD(-0.10)[mx.example.org]; ' +
  'MIME_GOOD(-0.10)[multipart/alternative,text/plain]; HAS_LIST_UNSUB(-0.01)[]; ' +
  'R_DKIM_ALLOW(0.00)[shared.example.com:s=def1]; RCPT_MAILCOW_DOMAIN(0.00)[peregrine.example]; ' +
  'DMARC_POLICY_ALLOW(0.00)[example.com,quarantine]; ARC_NA(0.00)[]'

describe('Rspamd', () => {
  const result = assessSpam({ 'x-spamd-result': RSPAMD })

  it('reads the score and the threshold the server used', () => {
    expect(result).toMatchObject({ score: 9.76, threshold: 15, source: 'rspamd' })
  })

  // 9.76 of 15 is well past half but short of the limit, which is the case the whole feature
  // exists for: the server let it through and it still deserves a second look.
  it('calls it borderline rather than spam when the server let it through', () => {
    expect(result?.verdict).toBe('borderline')
    expect(result?.ratio).toBeCloseTo(0.651, 3)
  })

  it('names the findings that pushed the score up, largest first', () => {
    expect(result?.symbols.slice(0, 3).map((s) => s.name)).toEqual([
      'MIME_FROM_MX_NONE',
      'URIBL_GREY',
      'BAD_REP_POLICIES'
    ])
  })

  it('leaves out what argued for the message and what carried no weight', () => {
    const names = result?.symbols.map((s) => s.name) ?? []
    expect(names).not.toContain('IP_REPUTATION_HAM')
    expect(names).not.toContain('ARC_NA')
  })

  // The brackets hold the recipient domain and internal ids. Nothing there belongs on screen.
  it('keeps the bracketed details out of the symbols', () => {
    expect(JSON.stringify(result?.symbols)).not.toContain('peregrine.example')
    expect(JSON.stringify(result?.symbols)).not.toContain('170.203')
  })

  it('calls it spam once the server threshold is reached', () => {
    expect(assessSpam({ 'x-spamd-result': 'default: True [15.20 / 15.00]; FOO(15.20)[]' })).toMatchObject(
      { verdict: 'spam' }
    )
  })

  it('says nothing about an ordinary message', () => {
    expect(assessSpam({ 'x-spamd-result': 'default: False [-1.10 / 15.00]; MIME_GOOD(-0.10)[]' }))
      .toMatchObject({ verdict: 'clean' })
  })
})

describe('SpamAssassin', () => {
  it('reads score, threshold and test names', () => {
    const result = assessSpam({
      'x-spam-status': 'Yes, score=7.5 required=5.0 tests=BAYES_99,URIBL_BLACK autolearn=no'
    })
    expect(result).toMatchObject({ score: 7.5, threshold: 5, verdict: 'spam', source: 'spamassassin' })
    expect(result?.symbols.map((s) => s.name)).toEqual(['BAYES_99', 'URIBL_BLACK'])
  })

  it('handles a clean message with no tests', () => {
    const result = assessSpam({ 'x-spam-status': 'No, score=0.1 required=5.0 tests=none' })
    expect(result).toMatchObject({ verdict: 'clean' })
    expect(result?.symbols).toEqual([])
  })
})

describe('the fallbacks', () => {
  it('takes a bare score against the conventional threshold of five', () => {
    expect(assessSpam({ 'x-spam-score': '6.0' })).toMatchObject({ verdict: 'spam', threshold: 5 })
  })

  // A flag says spam and nothing else. Reporting it as exactly at the limit is honest; giving
  // it a score it never had would not be.
  it('accepts a bare flag without inventing a number for it', () => {
    expect(assessSpam({ 'x-spam-flag': 'YES' })).toMatchObject({
      verdict: 'spam',
      ratio: 1,
      source: 'flag'
    })
    expect(assessSpam({ 'x-spam': 'Yes' })?.verdict).toBe('spam')
  })

  it('does not treat a negative flag as a verdict at all', () => {
    expect(assessSpam({ 'x-spam-flag': 'NO' })).toBeNull()
  })

  it('prefers the scored header when both are present', () => {
    const result = assessSpam({ 'x-spamd-result': RSPAMD, 'x-spam-flag': 'YES' })
    expect(result?.source).toBe('rspamd')
  })
})

describe('messages no filter touched', () => {
  it('yields nothing rather than a made-up verdict', () => {
    expect(assessSpam({})).toBeNull()
    expect(assessSpam({ subject: 'Hallo' })).toBeNull()
  })

  it('survives a header it cannot make sense of', () => {
    expect(assessSpam({ 'x-spamd-result': 'default: False' })).toBeNull()
    expect(assessSpam({ 'x-spam-status': 'Yes' })).toBeNull()
  })

  // Repeated headers arrive as arrays; a relay adding its own must not break the read.
  it('reads the first value when a header repeats', () => {
    expect(assessSpam({ 'x-spamd-result': ['default: False [2.00 / 10.00]; A(2.00)[]', 'x'] }))
      .toMatchObject({ score: 2, threshold: 10 })
  })
})
