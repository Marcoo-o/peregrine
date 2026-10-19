import { describe, expect, it } from 'vitest'
import { childrenOf, parseHeaderValue, splitPart } from './mimeParts'

const bytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0))
const crlf = (lines: string[]): string => lines.join('\r\n')

describe('a header value and its parameters', () => {
  it('has the value in lower case and the parameters by lower-case name', () => {
    const parsed = parseHeaderValue('Text/Plain; Charset=UTF-8; Format=flowed')
    expect(parsed.value).toBe('text/plain')
    expect([...parsed.params]).toEqual([
      ['charset', 'UTF-8'],
      ['format', 'flowed']
    ])
  })

  it('has no parameters when there are none, and nothing for nothing', () => {
    expect(parseHeaderValue('attachment').params.size).toBe(0)
    expect(parseHeaderValue(undefined)).toEqual({ value: '', params: new Map() })
  })

  it('reads a quoted value with a semicolon and an escaped quote in it', () => {
    const parsed = parseHeaderValue('attachment; filename="a;b \\"c\\".txt"; size=10')
    expect(parsed.params.get('filename')).toBe('a;b "c".txt')
    expect(parsed.params.get('size')).toBe('10')
  })

  it('skips a name that has no value', () => {
    expect(parseHeaderValue('attachment; broken; filename=a.txt').params.get('filename')).toBe('a.txt')
  })

  describe('RFC 2231', () => {
    it('decodes a name that is given in a charset', () => {
      const parsed = parseHeaderValue("attachment; filename*=UTF-8''Gr%C3%BC%C3%9Fe.pdf")
      expect(parsed.params.get('filename')).toBe('Grüße.pdf')
    })

    it('decodes a charset that is not UTF-8', () => {
      const parsed = parseHeaderValue("attachment; filename*=ISO-8859-1''Gr%FC%DFe.pdf")
      expect(parsed.params.get('filename')).toBe('Grüße.pdf')
    })

    it('puts the pieces of a long name together in their order, though they come in another', () => {
      const parsed = parseHeaderValue("attachment; filename*1*=%C3%9Fe.pdf; filename*0*=UTF-8''Gr%C3%BC")
      expect(parsed.params.get('filename')).toBe('Grüße.pdf')
    })

    it('puts together pieces that are not encoded', () => {
      const parsed = parseHeaderValue('attachment; filename*0="long-name-"; filename*1="part-two.txt"')
      expect(parsed.params.get('filename')).toBe('long-name-part-two.txt')
    })

    it('takes a plain piece next to encoded ones as it is', () => {
      const parsed = parseHeaderValue("attachment; filename*0*=UTF-8''Gr%C3%BC; filename*1=ssen.txt")
      expect(parsed.params.get('filename')).toBe('Grüssen.txt')
    })
  })
})

describe('the parts of a message', () => {
  it('splits a multipart body at its boundary', () => {
    const source = crlf([
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      'preamble',
      '--b1',
      'Content-Type: text/plain',
      '',
      'one',
      '--b1',
      'Content-Type: text/html',
      '',
      'two',
      '--b1--',
      ''
    ])
    const children = childrenOf(splitPart(bytes(source)))
    expect(children).toHaveLength(2)
    expect(children[0].headers.get('content-type')).toBe('text/plain')
    expect(new TextDecoder().decode(children[1].body)).toBe('two')
  })

  it('has no children for a part that is not a multipart, or has no boundary', () => {
    expect(childrenOf(splitPart(bytes('Content-Type: text/plain\r\n\r\nx')))).toEqual([])
    expect(childrenOf(splitPart(bytes('Content-Type: multipart/mixed\r\n\r\nx')))).toEqual([])
  })
})
