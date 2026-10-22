import { describe, expect, it } from 'vitest'
import { themeFor, withAlpha, type Palette } from './theme'

/** The relative luminance of a `#rrggbb` colour, as WCAG defines it. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** What is read, on what it is read on. 4.5 is what WCAG asks of text of this size. */
const READABLE: [text: keyof Palette, on: keyof Palette][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['muted', 'background'],
  ['muted', 'surface'],
  ['accent', 'background'],
  ['accent', 'surface'],
  ['onAccent', 'accent'],
  ['danger', 'background'],
  ['danger', 'dangerSoft'],
  ['success', 'background'],
  ['warning', 'background']
]

describe('the colours of the screens', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const { colors } = themeFor(scheme)
    for (const [text, on] of READABLE) {
      it(`${text} can be read on ${on} in ${scheme}`, () => {
        expect(contrast(colors[text], colors[on])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('is light unless the system says dark', () => {
    expect(themeFor('dark').scheme).toBe('dark')
    expect(themeFor('light').scheme).toBe('light')
    expect(themeFor(null).scheme).toBe('light')
    expect(themeFor(undefined).scheme).toBe('light')
  })

  it('has the tint of the accent as the accent with an opacity', () => {
    expect(withAlpha('#2f5d9f', 0.12)).toBe('#2f5d9f1f')
    expect(withAlpha('#000000', 1)).toBe('#000000ff')
    expect(withAlpha('#000000', 0)).toBe('#00000000')
  })
})
