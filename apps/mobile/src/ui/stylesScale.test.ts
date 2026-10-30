import { describe, expect, it } from 'vitest'
import { scaled } from './scaleStyles'

const base = {
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  box: { padding: 12, borderRadius: 6 }
}

describe('the styles at a text size', () => {
  it('are the styles themselves at normal size', () => {
    expect(scaled(base, 1)).toBe(base)
  })

  it('have every size of text multiplied, to the half of a point, and the line heights with them', () => {
    const big = scaled(base, 1.3)
    expect(big.title).toEqual({ fontSize: 26, fontWeight: '700' })
    expect(big.body).toEqual({ fontSize: 19.5, lineHeight: 28.5 })
  })

  it('leave what is not text as it is, and do not change what they were given', () => {
    const big = scaled(base, 1.15)
    expect(big.box).toBe(base.box)
    expect(base.title.fontSize).toBe(20)
  })

  it('make smaller as well', () => {
    expect(scaled(base, 0.9).body).toEqual({ fontSize: 13.5, lineHeight: 20 })
  })
})
