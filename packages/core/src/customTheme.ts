/**
 * A user-defined colour scheme.
 *
 * Only the surfaces and text are offered, not the status colours: red for danger and green
 * for success carry meaning rather than taste, and letting them be repainted would make a
 * deletion warning indistinguishable from a confirmation.
 */

export type ThemeTokenId =
  | 'bg'
  | 'bgElevated'
  | 'bgSunken'
  | 'text'
  | 'textMuted'
  | 'border'

/** Maps each token to the CSS custom property it overrides. */
export const THEME_TOKENS: Record<ThemeTokenId, string> = {
  bg: '--bg',
  bgElevated: '--bg-elevated',
  bgSunken: '--bg-sunken',
  text: '--text',
  textMuted: '--text-muted',
  border: '--border'
}

export const THEME_TOKEN_IDS = Object.keys(THEME_TOKENS) as ThemeTokenId[]

export type CustomTheme = Partial<Record<ThemeTokenId, string>>

const HEX = /^#[0-9a-f]{6}$/i

/**
 * Reads a stored or pasted theme, keeping only what is safely usable.
 *
 * Values go straight into a CSS custom property, so anything that is not a plain hex colour
 * is dropped rather than passed through. A value like `red; background: url(...)` would
 * otherwise be an opening for whatever a pasted "theme" wants to do.
 */
export function parseCustomTheme(raw: string): CustomTheme {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}

  const theme: CustomTheme = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in THEME_TOKENS)) continue
    if (typeof value !== 'string' || !HEX.test(value)) continue
    theme[key as ThemeTokenId] = value.toLowerCase()
  }
  return theme
}

export function serializeCustomTheme(theme: CustomTheme): string {
  return JSON.stringify(theme, null, 2)
}

/**
 * Relative luminance per WCAG, used to pick readable text over a chosen background.
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** WCAG AA for body text. Below this, a scheme is reported as hard to read. */
const MIN_CONTRAST = 4.5

export interface ThemeWarning {
  token: ThemeTokenId
  against: ThemeTokenId
  ratio: number
}

/**
 * Checks a scheme for combinations that cannot be read.
 *
 * Reported rather than corrected or refused: it is the user's scheme, and someone may well
 * want low contrast somewhere on purpose. But a scheme that renders text invisible is worth
 * saying out loud, because the place it becomes obvious is usually somewhere else entirely.
 */
export function themeWarnings(theme: CustomTheme): ThemeWarning[] {
  const pairs: Array<[ThemeTokenId, ThemeTokenId]> = [
    ['text', 'bg'],
    ['text', 'bgElevated'],
    ['textMuted', 'bg'],
    ['textMuted', 'bgElevated']
  ]

  const warnings: ThemeWarning[] = []
  for (const [token, against] of pairs) {
    const foreground = theme[token]
    const background = theme[against]
    // Only judge pairs the user actually set: mixing a chosen colour with a built-in one
    // would depend on the theme in force and could not be stated reliably.
    if (!foreground || !background) continue
    const ratio = contrastRatio(foreground, background)
    if (ratio < MIN_CONTRAST) warnings.push({ token, against, ratio })
  }
  return warnings
}
