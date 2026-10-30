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
