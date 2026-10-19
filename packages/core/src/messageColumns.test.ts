import { describe, expect, it } from 'vitest'
import { DEFAULT_COLUMNS, parseColumns, parseColumnWidths, widthOf } from './messageColumns'

describe('parseColumns', () => {
  it('reads a stored list', () => {
    expect(parseColumns('["date","subject","account"]')).toEqual(['date', 'subject', 'account'])
  })

  it('falls back to the defaults for unreadable input', () => {
    expect(parseColumns('kaputt')).toEqual(DEFAULT_COLUMNS)
    expect(parseColumns('{"a":1}')).toEqual(DEFAULT_COLUMNS)
  })

  it('drops ids it does not know, so an older version cannot break the list', () => {
    expect(parseColumns('["subject","erfunden","date"]')).toEqual(['subject', 'date'])
  })

  it('drops duplicates', () => {
    expect(parseColumns('["subject","date","date"]')).toEqual(['subject', 'date'])
  })

  // A list without subjects cannot be worked with, and there would be no way back to the
  // setting from inside it.
  it('puts the subject back if it is missing', () => {
    expect(parseColumns('["date","size"]')).toEqual(['subject', 'date', 'size'])
  })

  it('accepts an empty list by falling back to the subject', () => {
    expect(parseColumns('[]')).toEqual(['subject'])
  })
})

describe('parseColumnWidths', () => {
  it('reads stored widths', () => {
    expect(parseColumnWidths('{"date":180}')).toEqual({ date: 180 })
  })

  it('ignores unknown columns and non-numbers', () => {
    expect(parseColumnWidths('{"erfunden":100,"date":"breit"}')).toEqual({})
  })

  it('clamps values that would make a column unusable', () => {
    expect(parseColumnWidths('{"date":5,"size":9000}')).toEqual({ date: 60, size: 520 })
  })

  it('survives unreadable input', () => {
    expect(parseColumnWidths('nope')).toEqual({})
  })
})

describe('widthOf', () => {
  it('prefers the stored width', () => {
    expect(widthOf('date', { date: 200 })).toBe(200)
  })

  it('falls back to the default', () => {
    expect(widthOf('date', {})).toBe(150)
  })
})
