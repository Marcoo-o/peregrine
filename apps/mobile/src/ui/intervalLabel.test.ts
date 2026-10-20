import { describe, expect, it } from 'vitest'
import { INTERVAL_CHOICES } from '../settings'
import { intervalLabel } from './intervalLabel'

describe('the label of an interval', () => {
  it('is in minutes below an hour and in hours from there', () => {
    expect(intervalLabel(15)).toBe('15 Min.')
    expect(intervalLabel(30)).toBe('30 Min.')
    expect(intervalLabel(60)).toBe('1 Std.')
    expect(intervalLabel(240)).toBe('4 Std.')
  })

  it('stays in minutes for what is not a whole number of hours', () => {
    expect(intervalLabel(90)).toBe('90 Min.')
  })

  it('has a different label for each of the choices', () => {
    const labels = INTERVAL_CHOICES.map(intervalLabel)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
