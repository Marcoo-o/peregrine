import { describe, expect, it } from 'vitest'
import { adviseUnsubscribe, parseUnsubscribe, safeHttpsUrl, safeMailto } from './unsubscribe'

const ONE_CLICK = 'List-Unsubscribe=One-Click'

describe('reading the List-Unsubscribe header', () => {
  it('finds a message to send and a page, in the order they are written', () => {
    const options = parseUnsubscribe('<mailto:leave@lists.example.net?subject=unsubscribe%20me>, <https://lists.example.net/u/abc123>', undefined)
    expect(options).toEqual({
      mail: { to: 'leave@lists.example.net', subject: 'unsubscribe me', body: '' },
      oneClick: null,
      page: { url: 'https://lists.example.net/u/abc123', host: 'lists.example.net' }
    })
  })

  it('offers one click only when the sender says it takes that', () => {
    const header = '<https://lists.example.net/u/abc123>'
    expect(parseUnsubscribe(header, ONE_CLICK)).toMatchObject({ oneClick: { host: 'lists.example.net' }, page: null })
    expect(parseUnsubscribe(header, undefined)).toMatchObject({ oneClick: null, page: { host: 'lists.example.net' } })
    expect(parseUnsubscribe(header, 'something else')).toMatchObject({ oneClick: null })
  })

  it('reads a header that was folded onto several lines, and entries with a comment around them', () => {
    const header = '(the list)  <mailto:leave@lists.example.net>,\r\n  <https://lists.example.net/u/\r\n abc>'
    expect(parseUnsubscribe(header, undefined)).toMatchObject({ mail: { to: 'leave@lists.example.net' }, page: { url: 'https://lists.example.net/u/abc' } })
  })

  it('has nothing when there is no header, or nothing in it that is safe', () => {
    expect(parseUnsubscribe(undefined, ONE_CLICK)).toBeNull()
    expect(parseUnsubscribe('', undefined)).toBeNull()
    expect(parseUnsubscribe('<http://lists.example.net/u/abc>', ONE_CLICK)).toBeNull()
    expect(parseUnsubscribe('not an address', undefined)).toBeNull()
  })
})

describe('an address that is safe to go to', () => {
  it('is https, on a public host, without a login and with the usual port', () => {
    expect(safeHttpsUrl('https://lists.example.net/u/abc?x=1#top')).toEqual({ url: 'https://lists.example.net/u/abc?x=1', host: 'lists.example.net' })
    expect(safeHttpsUrl('https://LISTS.Example.NET')).toMatchObject({ host: 'lists.example.net' })
  })

  it.each([
    ['plain http', 'http://lists.example.net/u'],
    ['a login in the address', 'https://user:pass@lists.example.net/u'],
    ['a host that looks like a login', 'https://lists.example.net@evil.example.org/u'],
    ['another port', 'https://lists.example.net:8443/u'],
    ['an address of a network', 'https://192.168.1.10/u'],
    ['an address with numbers only', 'https://3232235786/u'],
    ['an address of this machine', 'https://127.0.0.1/u'],
    ['localhost', 'https://localhost/u'],
    ['a name without a dot', 'https://intranet/u'],
    ['a name of a private network', 'https://printer.local/u'],
    ['a name of an internal network', 'https://wiki.internal/u'],
    ['an address in brackets', 'https://[::1]/u'],
    ['a javascript address', 'javascript:alert(1)'],
    ['an address that is far too long', 'https://lists.example.net/' + 'a'.repeat(2100)]
  ])('is not %s', (_name, entry) => {
    expect(safeHttpsUrl(entry)).toBeNull()
  })
})

describe('a message to unsubscribe with', () => {
  it('takes one address, with its subject and body on the lines they should be', () => {
    expect(safeMailto('mailto:leave@lists.example.net?subject=Please%0D%0Aunsubscribe&body=Line%201%0D%0ALine%202')).toEqual({
      to: 'leave@lists.example.net',
      subject: 'Please unsubscribe',
      body: 'Line 1\nLine 2'
    })
  })

  it('is not several addresses, and not one that is not an address', () => {
    expect(safeMailto('mailto:a@lists.example.net,b@lists.example.net')).toBeNull()
    expect(safeMailto('mailto:no-address')).toBeNull()
    expect(safeMailto('mailto:')).toBeNull()
    expect(safeMailto('https://lists.example.net')).toBeNull()
  })

  it('has its subject and body cut short', () => {
    const mail = safeMailto(`mailto:leave@lists.example.net?subject=${'s'.repeat(500)}&body=${'b'.repeat(3000)}`)
    expect(mail?.subject).toHaveLength(200)
    expect(mail?.body).toHaveLength(1000)
  })
})

describe('what to advise', () => {
  const quiet = { suspicious: false, firstContact: false, senderDomain: 'lists.example.net' }
  const options = (over = {}) => ({ mail: null, oneClick: null, page: null, ...over })
  const click = { url: 'https://lists.example.net/u/1', host: 'lists.example.net' }
  const mail = { to: 'leave@lists.example.net', subject: '', body: '' }

  it('prefers one click, then a message, then a page', () => {
    expect(adviseUnsubscribe(options({ oneClick: click, mail }), quiet).mode).toBe('one-click')
    expect(adviseUnsubscribe(options({ mail, page: click }), quiet).mode).toBe('mail')
    expect(adviseUnsubscribe(options({ page: click }), quiet).mode).toBe('page')
  })

  it('says where it goes: the host, or the address', () => {
    expect(adviseUnsubscribe(options({ oneClick: click }), quiet).target).toBe('lists.example.net')
    expect(adviseUnsubscribe(options({ mail }), quiet).target).toBe('leave@lists.example.net')
  })

  it('offers nothing for a message that looks wrong, and says that it held back', () => {
    const advice = adviseUnsubscribe(options({ oneClick: click }), { ...quiet, suspicious: true })
    expect(advice).toMatchObject({ mode: null, blocked: true })
  })

  it('is not blocked when there was nothing to offer anyway', () => {
    expect(adviseUnsubscribe(options(), { ...quiet, suspicious: true })).toMatchObject({ mode: null, blocked: false })
  })

  it('warns about a first contact, and about an address of another site', () => {
    expect(adviseUnsubscribe(options({ oneClick: click }), { ...quiet, firstContact: true }).cautions).toEqual(['first-contact'])
    const other = { url: 'https://sends.example.org/u/1', host: 'sends.example.org' }
    expect(adviseUnsubscribe(options({ oneClick: other }), quiet).cautions).toEqual(['other-site'])
    expect(adviseUnsubscribe(options({ mail: { ...mail, to: 'leave@other.example.org' } }), quiet).cautions).toEqual(['other-site'])
  })

  it('takes a subdomain of the sender (or the other way round) for the same site', () => {
    const sub = { url: 'https://click.lists.example.net/u/1', host: 'click.lists.example.net' }
    expect(adviseUnsubscribe(options({ oneClick: sub }), quiet).cautions).toEqual([])
    expect(adviseUnsubscribe(options({ oneClick: click }), { ...quiet, senderDomain: 'example.net' }).cautions).toEqual([])
  })
})
