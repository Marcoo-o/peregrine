import { describe, expect, it } from 'vitest'
import { jobNameOf, printDocumentOf } from './printing'
import { RnPrinter } from './RnPrinter'
import { readable } from './testing/readable'

describe('the name of a print job', () => {
  it('is the subject, without what a file cannot be called, on one line and not too long', () => {
    expect(jobNameOf('Budget: Q3 / draft?')).toBe('Budget Q3 draft')
    expect(jobNameOf('a\nb\t c')).toBe('a b c')
    expect(jobNameOf('x'.repeat(200))).toHaveLength(80)
  })

  it('is "Nachricht" for a subject that is empty or only what is taken out', () => {
    expect(jobNameOf('')).toBe('Nachricht')
    expect(jobNameOf(' / : ')).toBe('Nachricht')
  })
})

describe('the page a message is printed on', () => {
  it('has the subject, who it is from, to and when above the text, and leaves out a line the message does not have', () => {
    const { html, jobName } = printDocumentOf(readable({ subject: 'Lunch', from: 'Anna <anna@example.net>', to: 'Alex <work@example.org>', cc: '', date: 'Fri, 30 Oct 2026 10:00', text: 'See you at noon.' }))
    expect(jobName).toBe('Lunch')
    expect(html).toContain('<h1')
    expect(html).toContain('Lunch')
    expect(html).toContain('Anna &lt;anna@example.net&gt;')
    expect(html).toContain('Fri, 30 Oct 2026 10:00')
    expect(html).not.toContain('Kopie')
    expect(html.indexOf('Lunch')).toBeLessThan(html.indexOf('See you at noon.'))
  })

  it('has a message that is only text set in a block that keeps its lines, and escaped', () => {
    const { html } = printDocumentOf(readable({ html: null, text: 'a < b & c\nsecond line <script>alert(1)</script>' }))
    expect(html).toContain('white-space:pre-wrap')
    expect(html).toContain('a &lt; b &amp; c\nsecond line &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)')
  })

  it('has the text of a message that is HTML as the reader has it: nothing that runs, and the images it carries', () => {
    const { html } = printDocumentOf(
      readable({ html: '<p>Hello</p><script>steal()</script><img src="cid:logo">', inlineImages: { logo: 'data:image/png;base64,AAAA' } })
    )
    expect(html).toContain('<p>Hello</p>')
    expect(html).not.toContain('steal()')
    expect(html).toContain('data:image/png;base64,AAAA')
  })

  it('is served under the policy that lets nothing be fetched from the network, since a print is not a reason for a sender to learn that it was read', () => {
    const { html } = printDocumentOf(readable({ html: '<img src="https://tracker.example.net/p.gif">' }))
    const policy = /Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(policy).not.toBe('')
    expect(policy).not.toMatch(/img-src[^;]*https/)
    expect(policy).toMatch(/script-src 'none'|default-src 'none'/)
  })

  it('has a subject for a message without one, and escapes what the subject says', () => {
    expect(printDocumentOf(readable({ subject: '' })).html).toContain('(ohne Betreff)')
    expect(printDocumentOf(readable({ subject: '<b>x</b>' })).html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('the print service of the device', () => {
  it('is asked through the native module, with the name of the job and the page', async () => {
    const calls: string[] = []
    const printer = new RnPrinter({ print: async (name, html) => void calls.push(`${name}|${html}`) })
    await printer.print('Lunch', '<p>x</p>')
    expect(calls).toEqual(['Lunch|<p>x</p>'])
  })
})
