import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCustomTheme, themeWarnings } from './customTheme'

describe('parseCustomTheme', () => {
  it('reads valid colours', () => {
    expect(parseCustomTheme('{"bg":"#101418","text":"#FFFFFF"}')).toEqual({
      bg: '#101418',
      text: '#ffffff'
    })
  })

  it('drops unknown tokens', () => {
    expect(parseCustomTheme('{"erfunden":"#ffffff"}')).toEqual({})
  })

  // These values go straight into a CSS custom property, so anything that is not a plain hex
  // colour has to be refused rather than passed through.
  it('refuses anything that is not a hex colour', () => {
    expect(parseCustomTheme('{"bg":"red"}')).toEqual({})
    expect(parseCustomTheme('{"bg":"#fff"}')).toEqual({})
    expect(parseCustomTheme('{"bg":"red; background: url(http://x)"}')).toEqual({})
    expect(parseCustomTheme('{"bg":"var(--secret)"}')).toEqual({})
    expect(parseCustomTheme('{"bg":123}')).toEqual({})
  })

  it('survives input that is not JSON at all', () => {
    expect(parseCustomTheme('kaputt')).toEqual({})
    expect(parseCustomTheme('[1,2]')).toEqual({})
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#3366aa', '#3366aa')).toBeCloseTo(1, 5)
  })

  it('does not depend on the order of the arguments', () => {
    expect(contrastRatio('#222222', '#dddddd')).toBeCloseTo(contrastRatio('#dddddd', '#222222'), 5)
  })
})

describe('themeWarnings', () => {
  it('says nothing about a readable scheme', () => {
    expect(themeWarnings({ text: '#1b1f24', bg: '#ffffff' })).toEqual([])
  })

  it('reports text that cannot be read on its background', () => {
    const warnings = themeWarnings({ text: '#f0f0f0', bg: '#ffffff' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ token: 'text', against: 'bg' })
  })

  // Judging a chosen colour against a built-in one would depend on the theme in force and
  // could not be stated reliably.
  it('judges only pairs the user actually set', () => {
    expect(themeWarnings({ text: '#ffffff' })).toEqual([])
  })

  it('checks the muted text as well', () => {
    const warnings = themeWarnings({ textMuted: '#eeeeee', bg: '#ffffff' })
    expect(warnings.map((w) => w.token)).toContain('textMuted')
  })
})
