import { describe, expect, it } from 'vitest'
import { FORMAT_MARK, insertLink, isFormattedHtml, renderHtml, toggleLines, toggleWrap } from './richText'

const body = (source: string): string => renderHtml(source).replace(FORMAT_MARK, '').replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '')

describe('the HTML made from what was typed', () => {
  it('carries the mark that says it was made here, and nothing else says so', () => {
    expect(isFormattedHtml(renderHtml('hello'))).toBe(true)
    expect(isFormattedHtml('<p>hello</p>')).toBe(false)
    expect(isFormattedHtml(null)).toBe(false)
  })

  it('makes paragraphs of the text between empty lines, and a line break of a new line', () => {
    expect(body('one\ntwo\n\nthree')).toBe('<p style="margin:0 0 8px">one<br>two</p><p style="margin:0 0 8px">three</p>')
  })

  it('makes bold, italic, struck and code of the markers, and not of a snake_case_name or a sum', () => {
    expect(body('**b** and *i* and _j_ and ~~s~~ and `c`')).toContain('<strong>b</strong> and <em>i</em> and <em>j</em> and <s>s</s> and <code>c</code>')
    expect(body('a snake_case_name')).not.toContain('<em>')
    expect(body('2 * 3 * 4')).not.toContain('<em>')
    expect(body('**not bold **')).not.toContain('<strong>')
  })

  it('keeps what is inside code as it is', () => {
    expect(body('`**x**`')).toContain('<code>**x**</code>')
  })

  it('makes lists, numbered lists, quotes (also inside each other), headings and a rule', () => {
    expect(body('- a\n- b')).toContain('<ul style="margin:0 0 8px;padding-left:24px"><li>a</li><li>b</li></ul>')
    expect(body('1. a\n2) b')).toContain('<ol')
    expect(body('1. a\n2) b')).toContain('<li>b</li>')
    expect(body('> one\n> > deeper')).toContain('<blockquote')
    expect(body('> one\n> > deeper').match(/<blockquote/g)).toHaveLength(2)
    expect(body('# Title')).toContain('<h2 style="margin:0 0 8px">Title</h2>')
    expect(body('above\n\n---\n\nbelow')).toContain('<hr>')
  })

  it('does not take the two dashes of a signature for a rule or a list', () => {
    const html = body('text\n-- \nAlex')
    expect(html).not.toContain('<hr>')
    expect(html).not.toContain('<li>')
    expect(html).toContain('-- ')
  })

  it('makes a link of the brackets, and of an address that stands alone, for web and mail addresses only', () => {
    expect(body('[site](https://example.org/a?b=1&c=2)')).toContain('<a href="https://example.org/a?b=1&amp;c=2">site</a>')
    expect(body('see https://example.org/x now')).toContain('<a href="https://example.org/x">https://example.org/x</a>')
    expect(body('[mail](mailto:alex@example.org)')).toContain('href="mailto:alex@example.org"')
    expect(body('[bad](javascript:alert(1))')).not.toContain('<a ')
    expect(body('[bad](file:///data/x)')).not.toContain('<a ')
  })

  it('writes nothing that was typed as a tag', () => {
    const html = body('<script>alert(1)</script> & "quoted" <b>x</b>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;quoted&quot;')
  })

  it('does not lose a line that only looks like the start of something', () => {
    expect(body('-')).toContain('-')
    expect(body('#')).toContain('#')
  })
})

describe('what the toolbar does to the text', () => {
  it('puts the marker round the selection, and takes it off again', () => {
    const wrapped = toggleWrap('say hello now', { start: 4, end: 9 }, '**')
    expect(wrapped).toEqual({ text: 'say **hello** now', selection: { start: 6, end: 11 } })
    expect(toggleWrap(wrapped.text, wrapped.selection, '**')).toEqual({ text: 'say hello now', selection: { start: 4, end: 9 } })
  })

  it('takes it off when the selection includes the markers, and leaves the cursor between two when nothing is selected', () => {
    expect(toggleWrap('a **b** c', { start: 2, end: 7 }, '**')).toEqual({ text: 'a b c', selection: { start: 2, end: 3 } })
    expect(toggleWrap('ab', { start: 1, end: 1 }, '_')).toEqual({ text: 'a__b', selection: { start: 2, end: 2 } })
  })

  it('takes a selection that was made backwards', () => {
    expect(toggleWrap('hello', { start: 5, end: 0 }, '*').text).toBe('*hello*')
  })

  it('puts a prefix before each line the selection touches, and takes it off when all have it', () => {
    const listed = toggleLines('one\ntwo\nthree', { start: 0, end: 7 }, '- ')
    expect(listed.text).toBe('- one\n- two\nthree')
    expect(toggleLines(listed.text, { start: 0, end: 11 }, '- ').text).toBe('one\ntwo\nthree')
    expect(toggleLines('a\nb', { start: 2, end: 2 }, '> ').text).toBe('a\n> b')
    expect(toggleLines('a', { start: 0, end: 0 }, '# ').text).toBe('# a')
  })

  it('numbers the lines for a numbered list, and takes the numbers off', () => {
    const numbered = toggleLines('a\nb\nc', { start: 0, end: 5 }, '1. ')
    expect(numbered.text).toBe('1. a\n2. b\n3. c')
    expect(toggleLines(numbered.text, { start: 0, end: numbered.text.length }, '1. ').text).toBe('a\nb\nc')
  })

  it('leaves the empty lines of a selection empty', () => {
    expect(toggleLines('a\n\nb', { start: 0, end: 4 }, '- ').text).toBe('- a\n\n- b')
  })

  it('makes a link of the selected words, or of the address itself', () => {
    expect(insertLink('visit our site', { start: 6, end: 14 }, 'https://example.org')).toEqual({
      text: 'visit [our site](https://example.org)',
      selection: { start: 37, end: 37 }
    })
    expect(insertLink('', { start: 0, end: 0 }, 'https://example.org').text).toBe('[https://example.org](https://example.org)')
  })
})
