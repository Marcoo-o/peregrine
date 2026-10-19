import { describe, expect, it } from 'vitest'
import { previewFromText, textFromHtml } from './bodyIndexer'
import { recipientsText } from '../db/migrations/008_fts_recipients'

describe('textFromHtml', () => {
  it('keeps the words and drops the markup', () => {
    expect(textFromHtml('<p>Hallo <b>Welt</b></p>')).toBe('Hallo Welt')
  })

  it('drops script and style content instead of indexing it', () => {
    const html = '<style>.a{color:red}</style><script>alert(1)</script><p>Rechnung</p>'
    expect(textFromHtml(html)).toBe('Rechnung')
  })

  it('resolves the entities a search would otherwise never match', () => {
    expect(textFromHtml('<p>M&uuml;ller &amp; S&#246;hne</p>')).toBe('Müller & Söhne')
  })

  it('leaves unknown entities alone rather than mangling them', () => {
    expect(textFromHtml('<p>&notanentity;</p>')).toBe('&notanentity;')
  })

  it('returns an empty string for markup without text', () => {
    expect(textFromHtml('<div><img src="x"></div>')).toBe('')
  })
})

describe('previewFromText', () => {
  it('collapses whitespace so the list shows one line', () => {
    expect(previewFromText('Hallo\n\n  Welt\t!')).toBe('Hallo Welt !')
  })

  it('caps the length', () => {
    expect(previewFromText('a'.repeat(500))).toHaveLength(200)
  })
})

describe('recipientsText', () => {
  it('flattens names and addresses of To and Cc into one searchable string', () => {
    const text = recipientsText(
      [{ name: 'Anna Meier', address: 'anna@example.com' }],
      [{ name: '', address: 'buchhaltung@example.com' }]
    )
    expect(text).toBe('Anna Meier anna@example.com buchhaltung@example.com')
  })

  it('skips entries without name and address', () => {
    expect(recipientsText([{ name: '', address: '' }], [])).toBe('')
  })
})
