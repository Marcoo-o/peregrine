import { describe, expect, it } from 'vitest'
import { tagMeta } from './tagMeta'

describe('the line under a tag', () => {
  it('says how many messages have it, in the singular and the plural', () => {
    expect(tagMeta('Work', 0)).toBe('Work · keine Nachricht')
    expect(tagMeta('Work', 1)).toBe('Work · 1 Nachricht')
    expect(tagMeta('Work', 12)).toBe('Work · 12 Nachrichten')
  })
})
