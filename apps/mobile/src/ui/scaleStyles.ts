/**
 * Every size of text in a set of styles multiplied, line heights with them, to the half of a point. Sizes of anything but text are left. Apart from
 * the styles so that it needs nothing of the platform and can be tested without it.
 */
export function scaled<T extends object>(styles: T, factor: number): T {
  if (factor === 1) return styles
  const round = (value: number): number => Math.round(value * factor * 2) / 2
  const entries = Object.entries(styles).map(([name, style]) => {
    const text = style as { fontSize?: number; lineHeight?: number }
    if (typeof text.fontSize !== 'number') return [name, style]
    return [name, { ...text, fontSize: round(text.fontSize), ...(typeof text.lineHeight === 'number' ? { lineHeight: round(text.lineHeight) } : {}) }]
  })
  return Object.fromEntries(entries) as T
}

/** How close the lines of a list sit. */
export type Density = 'comfortable' | 'cozy' | 'compact'

export const DENSITY_FACTOR: Record<Density, number> = { comfortable: 1.3, cozy: 1, compact: 0.6 }

/** The styles whose vertical padding is the room a line of a list has. A touch target stays at its minimum height whatever the padding. */
export const DENSE_STYLES: readonly string[] = ['item', 'tagSheetRow', 'sheetItem', 'sidebarRow']

/** The vertical padding of the lines of a list multiplied by the density, to a whole point. The rest of the styles is left as it is. */
export function densified<T extends object>(styles: T, density: Density): T {
  const factor = DENSITY_FACTOR[density]
  if (factor === 1) return styles
  const entries = Object.entries(styles).map(([name, style]) => {
    const padded = style as { paddingVertical?: number }
    if (!DENSE_STYLES.includes(name) || typeof padded.paddingVertical !== 'number') return [name, style]
    return [name, { ...padded, paddingVertical: Math.round(padded.paddingVertical * factor) }]
  })
  return Object.fromEntries(entries) as T
}
