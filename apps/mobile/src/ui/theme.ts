/**
 * The colours of the screens, taken from the desktop application (`src/renderer/src/styles.css`) so that
 * the two look like one. The light values have to hold up as text on a light background, the dark ones on
 * a near black one, which is why they are not the same hue at two brightnesses. The test in `theme.test.ts`
 * measures it.
 */
export interface Palette {
  /** The page. */
  background: string
  /** What stands out of the page: fields, buttons, the bar at the top. */
  surface: string
  /** What sits below it: a field that is switched off, the track of a switch. */
  sunken: string
  text: string
  /** What is said in passing: who wrote, when, what a setting means. */
  muted: string
  border: string
  accent: string
  /** The colour of what is written on the accent. */
  onAccent: string
  /** The accent as a tint, for what is chosen or has something to say. */
  accentSoft: string
  danger: string
  dangerSoft: string
  success: string
  warning: string
}

export type SchemeName = 'light' | 'dark'

export interface Theme {
  scheme: SchemeName
  colors: Palette
}

/** The accent is the one of the desktop's default, blue. A light and a dark value of it. */
const ACCENT = { light: '#2f5d9f', dark: '#6d9eeb' } as const

/** `#rrggbb` with an opacity, which React Native reads as `#rrggbbaa`. */
export function withAlpha(hex: string, opacity: number): string {
  const alpha = Math.round(opacity * 255)
  return `${hex}${alpha.toString(16).padStart(2, '0')}`
}

const LIGHT: Theme = {
  scheme: 'light',
  colors: {
    background: '#f4f5f7',
    surface: '#ffffff',
    sunken: '#eceef1',
    text: '#1b1f24',
    muted: '#5c6570',
    border: '#dbdfe4',
    accent: ACCENT.light,
    onAccent: '#ffffff',
    accentSoft: withAlpha(ACCENT.light, 0.12),
    danger: '#b23b3b',
    dangerSoft: '#fbeaea',
    success: '#2a7a4f',
    // The desktop's #b0791f is 3.4 to 1 on this background, which is not enough for text.
    warning: '#926318'
  }
}

const DARK: Theme = {
  scheme: 'dark',
  colors: {
    background: '#1b1e23',
    surface: '#23272e',
    sunken: '#16181c',
    text: '#e7e9ec',
    muted: '#9aa3ad',
    border: '#343a42',
    accent: ACCENT.dark,
    onAccent: '#0f1216',
    accentSoft: withAlpha(ACCENT.dark, 0.12),
    danger: '#e08080',
    dangerSoft: '#3a2323',
    success: '#7ec89a',
    warning: '#d9a441'
  }
}

/** The theme for what the system has chosen. It has chosen light when it does not say. */
export function themeFor(scheme: string | null | undefined): Theme {
  return scheme === 'dark' ? DARK : LIGHT
}

/** The sizes the screens are made of, so that a gap or a corner is the same wherever it is. */
export const SIZE = {
  /** Corners of buttons, fields and banners. The desktop has 6, a thumb is given a little more. */
  radius: 8,
  /** The least height of anything that is tapped, which is what Android asks for. */
  target: 48,
  gap: 8,
  padding: 16
} as const
