import { describe, expect, it } from 'vitest'
import { senderName } from './senderName'

describe('who wrote', () => {
  it('is the name the sender gave, or the address when there is none', () => {
    expect(senderName('Anna <anna@example.net>')).toBe('Anna')
    expect(senderName('"Anna B." <anna@example.net>')).toBe('Anna B.')
    expect(senderName('anna@example.net')).toBe('anna@example.net')
    expect(senderName('<anna@example.net>')).toBe('anna@example.net')
  })
})
