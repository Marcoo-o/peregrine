import { describe, expect, it } from 'vitest'
import { mailContentCsp } from '@peregrine/core/mailCsp'
import { buildMailDocument } from './mailDocument'

const build = (html: string, over: { allowRemoteImages?: boolean; inlineImages?: Record<string, string> } = {}) =>
  buildMailDocument({ html, allowRemoteImages: false, inlineImages: {}, ...over })

const policyOf = (document: string): string => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(document)?.[1] ?? ''

describe('the document a message is shown in', () => {
  it('has the policy of the reader first, before anything the sender wrote', () => {
    const document = build('<p>Hello</p>')
    expect(policyOf(document)).toBe(mailContentCsp({ surface: 'reader', allowRemoteImages: false }))
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf('Hello'))
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf('<style>'))
  })

  it('lets no image in from the sender servers until it is asked to', () => {
    expect(policyOf(build('<p>x</p>'))).toContain("img-src data:;")
    expect(policyOf(build('<p>x</p>', { allowRemoteImages: true }))).toContain('img-src data: https: http:;')
  })

  it('lets no script of the message run, and no form go anywhere', () => {
    const policy = policyOf(build('<p>x</p>'))
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(policy).not.toContain('script-src')
  })

  it('shows the content of the message in a page of its own, not the page the message brought', () => {
    const document = build('<html><head><title>t</title><style>p{color:red}</style></head><body bgcolor="x"><p>Hello</p></body></html>')
    expect(document).toContain('<p>Hello</p>')
    expect(document).toContain('p{color:red}')
    expect(document.match(/<body/g)).toHaveLength(1)
    expect(document.match(/<head>/g)).toHaveLength(1)
    expect(document).not.toContain('<title>')
  })

  it('leaves out what is of no use in a message and could only be used against the reader', () => {
    const document = build(
      [
        '<p>kept</p>',
        '<SCRIPT>alert(1)</SCRIPT>',
        '<script src="https://evil.test/x.js"></script>',
        '<iframe src="https://evil.test"></iframe>',
        '<object data="x"></object><embed src="x">',
        '<base href="https://evil.test/">',
        '<meta http-equiv="refresh" content="0;url=https://evil.test">',
        '<link rel="stylesheet" href="https://evil.test/x.css">',
        '<script src="https://evil.test/unclosed.js">'
      ].join('')
    )
    expect(document).toContain('<p>kept</p>')
    for (const gone of ['alert(1)', 'evil.test', '<iframe', '<object', '<embed', '<base', 'refresh', '<link']) {
      expect(document).not.toContain(gone)
    }
    // The only script is none at all, and the only meta ones are those of this document.
    expect(document).not.toContain('<script')
    expect(document.match(/<meta/g)).toHaveLength(2)
  })

  it('shows the images a message carries as the data it has', () => {
    const document = build('<img src="cid:logo@example.net"><div style="background:url(cid:bg)"></div>', {
      inlineImages: { 'logo@example.net': 'data:image/png;base64,AAAA', bg: 'data:image/gif;base64,BBBB' }
    })
    expect(document).toContain('<img src="data:image/png;base64,AAAA">')
    expect(document).toContain('url(data:image/gif;base64,BBBB)')
  })

  it('finds an image by its content id however the address spells it', () => {
    const document = build('<img src="cid:logo%40example.net">', { inlineImages: { 'logo@example.net': 'data:image/png;base64,AAAA' } })
    expect(document).toContain('data:image/png;base64,AAAA')
  })

  it('leaves an image it has no data for, which the policy will not load', () => {
    expect(build('<img src="cid:missing">')).toContain('cid:missing')
  })

  it('fits the page to the width of the phone', () => {
    const document = build('<p>x</p>')
    expect(document).toContain('name="viewport"')
    expect(document).toContain('max-width:100%')
  })
})
