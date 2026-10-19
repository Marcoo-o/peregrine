// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeMailHtml, sanitizeMailParts } from './sanitizeMail'

/**
 * These are the messages that were tried against the reading pane, kept as tests because both
 * halves have already regressed once. The layout attributes were silently stripped for months,
 * and the first attempt to restore them used `ADD_ATTR` and did nothing at all. A test that only
 * checked for the absence of scripts would have passed throughout.
 *
 * The parser here is jsdom rather than Chromium, so this covers the configuration rather than
 * the browser's own parsing quirks. That is the half that keeps being got wrong.
 */

const READER = { allowRemote: true, wholeDocument: false } as const
const PRINT_BLOCKED = { allowRemote: false, wholeDocument: false } as const

describe('layout survives', () => {
  it.each([
    ['width', '<table width="600"></table>', 'width="600"'],
    ['cellpadding', '<table cellpadding="0"></table>', 'cellpadding="0"'],
    ['align', '<table align="center"></table>', 'align="center"'],
    ['bgcolor', '<table><tr><td bgcolor="#ffffff"></td></tr></table>', 'bgcolor="#ffffff"'],
    ['valign', '<table><tr><td valign="top"></td></tr></table>', 'valign="top"'],
    ['colspan', '<table><tr><td colspan="2"></td></tr></table>', 'colspan="2"'],
    ['height', '<img src="cid:a" height="60">', 'height="60"'],
    ['face', '<font face="Arial">x</font>', 'face="Arial"'],
    ['dir', '<div dir="rtl">x</div>', 'dir="rtl"']
  ])('%s', (_name, input, expected) => {
    expect(sanitizeMailHtml(input, READER)).toContain(expected)
  })

  it('keeps a stylesheet, which was never the problem', () => {
    const html = '<style>@media print { .a { color: red } }</style><div class="a">x</div>'
    expect(sanitizeMailHtml(html, { allowRemote: true, wholeDocument: true })).toContain(
      '@media print'
    )
  })
})

describe('splitting a message for a page of its own', () => {
  const html = '<style>.a { color: red }</style><div class="a">x</div>'

  it('hands back the stylesheet a fragment would have thrown away', () => {
    expect(sanitizeMailParts(html, true).styles).toEqual(['.a { color: red }'])
  })

  it('hands back the body without the stylesheet', () => {
    const parts = sanitizeMailParts(html, true)
    expect(parts.body).toContain('<div class="a">x</div>')
    expect(parts.body).not.toContain('<style')
  })

  it('sanitises the same way as everything else', () => {
    const parts = sanitizeMailParts('<div onclick="alert(1)">x</div><script>alert(1)</script>', true)
    expect(parts.body).not.toMatch(/onclick|<script/i)
  })

  it('cannot smuggle a closing style tag into the page it is placed in', () => {
    const parts = sanitizeMailParts('<style>.a { content: "x" }</style>x', true)
    expect(parts.styles.join('')).not.toMatch(/<\/style/i)
  })
})

describe('attacks do not survive', () => {
  it.each([
    ['event handler', '<img src="cid:x" onerror="alert(1)">', /onerror/i],
    ['javascript url', '<a href="javascript:alert(1)">x</a>', /javascript:/i],
    ['script element', '<script>alert(1)</script>', /<script/i],
    ['login form', '<form action="https://evil.invalid"><input name="p"></form>', /<form|<input/i],
    ['iframe', '<iframe src="https://evil.invalid"></iframe>', /<iframe/i],
    ['script inside svg', '<svg><script>alert(1)</script></svg>', /<script/i],
    ['object', '<object data="https://evil.invalid/x"></object>', /<object/i],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.invalid">', /http-equiv/i],
    ['base tag', '<base href="https://evil.invalid/">', /<base/i],
    ['handler beside style', '<div style="width:1px" onmouseover="alert(1)">x</div>', /onmouseover/i],
    ['unknown scheme', '<img src="ftp://evil.invalid/x.png">', /ftp:/i]
  ])('%s', (_name, input, forbidden) => {
    expect(sanitizeMailHtml(input, READER)).not.toMatch(forbidden)
  })

  it('checks the background url even though the layout attributes skip that check', () => {
    expect(sanitizeMailHtml('<td background="javascript:alert(1)">x</td>', READER)).not.toMatch(
      /javascript:/i
    )
  })
})

describe('remote content', () => {
  it('keeps links in the reading pane, which blocks images by other means', () => {
    expect(sanitizeMailHtml('<a href="https://example.invalid/a">x</a>', READER)).toContain(
      'https://example.invalid/a'
    )
  })

  it('drops remote urls when printing with images blocked', () => {
    expect(sanitizeMailHtml('<img src="https://tracker.invalid/p.gif">', PRINT_BLOCKED)).not.toMatch(
      /tracker\.invalid/
    )
  })

  it('keeps embedded images, which come from the message itself', () => {
    expect(sanitizeMailHtml('<img src="cid:logo">', PRINT_BLOCKED)).toContain('cid:logo')
  })
})
