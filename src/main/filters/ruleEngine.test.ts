import { describe, expect, it } from 'vitest'
import type { FilterCondition, FilterRule } from '@peregrine/core/types'
import { fieldValue, matchesCondition, matchesRule, type FilterableMessage } from './ruleEngine'

const message: FilterableMessage = {
  subject: 'Ihre Rechnung',
  from: [{ name: 'Bonusprogramm', address: 'info@mail.bonusprogramm.example' }],
  to: [{ name: 'John', address: 'mobility@peregrine.example' }],
  cc: [],
  textBody: 'Anbei Ihre Rechnung für August.',
  sizeBytes: 71000,
  hasAttachments: true
}

function condition(overrides: Partial<FilterCondition> = {}): FilterCondition {
  return { field: 'from', operator: 'contains', value: 'bonusprogramm', ...overrides }
}

function rule(overrides: Partial<FilterRule> = {}): FilterRule {
  return {
    id: 'r1',
    accountId: 'a1',
    name: 'Regel',
    matchMode: 'all',
    conditions: [condition()],
    actions: [{ type: 'move', targetFolderId: 'f2' }],
    enabled: true,
    priority: 0,
    ...overrides
  }
}

describe('fieldValue', () => {
  it('reads text fields including both name and address', () => {
    expect(fieldValue('subject', message)).toBe('Ihre Rechnung')
    expect(fieldValue('from', message)).toBe('Bonusprogramm info@mail.bonusprogramm.example')
    expect(fieldValue('to', message)).toBe('John mobility@peregrine.example')
  })

  it('reads the non-text fields with their own types', () => {
    expect(fieldValue('sizeBytes', message)).toBe(71000)
    expect(fieldValue('hasAttachment', message)).toBe(true)
  })

  it('returns null for a body that has not been fetched yet', () => {
    expect(fieldValue('body', { ...message, textBody: null })).toBeNull()
  })
})

describe('matchesCondition', () => {
  it('matches text case-insensitively', () => {
    expect(matchesCondition(condition({ value: 'BONUSPROGRAMM' }), message)).toBe(true)
  })

  it('supports the text operators', () => {
    expect(matchesCondition(condition({ operator: 'notContains', value: 'flix' }), message)).toBe(true)
    expect(
      matchesCondition(
        condition({ field: 'subject', operator: 'startsWith', value: 'Ihre' }),
        message
      )
    ).toBe(true)
    expect(
      matchesCondition(
        condition({ field: 'subject', operator: 'endsWith', value: 'rechnung' }),
        message
      )
    ).toBe(true)
    expect(
      matchesCondition(
        condition({ field: 'subject', operator: 'equals', value: 'ihre rechnung' }),
        message
      )
    ).toBe(true)
  })

  it('supports regular expressions and survives a broken pattern', () => {
    expect(
      matchesCondition(condition({ operator: 'regex', value: 'bonusprogramm\\.(example|test)' }), message)
    ).toBe(true)
    expect(matchesCondition(condition({ operator: 'regex', value: '([unclosed' }), message)).toBe(
      false
    )
  })

  it('compares sizes numerically', () => {
    const size = condition({ field: 'sizeBytes', operator: 'greaterThan', value: '50000' })
    expect(matchesCondition(size, message)).toBe(true)
    expect(matchesCondition({ ...size, operator: 'lessThan' }, message)).toBe(false)
  })

  it('rejects a size condition whose value is not a number', () => {
    expect(
      matchesCondition(
        condition({ field: 'sizeBytes', operator: 'greaterThan', value: 'groß' }),
        message
      )
    ).toBe(false)
  })

  it('handles the boolean field in both directions', () => {
    const has = condition({ field: 'hasAttachment', operator: 'isTrue', value: '' })
    expect(matchesCondition(has, message)).toBe(true)
    expect(matchesCondition({ ...has, operator: 'isFalse' }, message)).toBe(false)
    expect(matchesCondition(has, { ...message, hasAttachments: false })).toBe(false)
  })

  it('never matches a body that was not fetched', () => {
    const body = condition({ field: 'body', operator: 'contains', value: 'rechnung' })
    expect(matchesCondition(body, message)).toBe(true)
    expect(matchesCondition(body, { ...message, textBody: null })).toBe(false)
  })
})

describe('matchesRule', () => {
  it('requires every condition in "all" mode', () => {
    const all = rule({
      matchMode: 'all',
      conditions: [condition(), condition({ field: 'subject', value: 'rechnung' })]
    })
    expect(matchesRule(all, message)).toBe(true)
    expect(matchesRule({ ...all, conditions: [condition(), condition({ value: 'flix' })] }, message)).toBe(
      false
    )
  })

  it('requires only one condition in "any" mode', () => {
    const any = rule({
      matchMode: 'any',
      conditions: [condition({ value: 'flix' }), condition({ field: 'subject', value: 'rechnung' })]
    })
    expect(matchesRule(any, message)).toBe(true)
  })

  it('never matches a rule without conditions', () => {
    expect(matchesRule(rule({ conditions: [] }), message)).toBe(false)
  })
})
