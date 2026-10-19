import { describe, expect, it } from 'vitest'
import { mailContentCsp } from './mailCsp'

const READER = { surface: 'reader', allowRemoteImages: false } as const
const HASH = 'K3n1Zb8+Qw9dQ0xUq2sSs0Jm4iZ1o5T6yYy0aB8cD1E='

describe('every document', () => {
  it.each([
    ["default-src 'none'"],
    ["form-action 'none'"],
    ["base-uri 'none'"],
    ["style-src 'unsafe-inline'"]
  ])('states %s', (directive) => {
    expect(mailContentCsp(READER)).toContain(directive)
    expect(mailContentCsp({ surface: 'print', allowRemoteImages: true })).toContain(directive)
  })
})

describe('remote images', () => {
  it('are not fetchable while they are blocked', () => {
    expect(mailContentCsp(READER)).not.toMatch(/https:|http:/)
  })

  it('become fetchable once the user has asked for them', () => {
    expect(mailContentCsp({ ...READER, allowRemoteImages: true })).toMatch(/img-src [^;]*https:/)
  })

  it('does not let the allowance reach anything but images', () => {
    const csp = mailContentCsp({ ...READER, allowRemoteImages: true })
    const other = csp.split(';').filter((part) => !part.includes('img-src'))
    expect(other.join(';')).not.toMatch(/https:|http:/)
  })
})

describe('the injected script', () => {
  it('is permitted in the reading pane by its digest', () => {
    expect(mailContentCsp({ ...READER, scriptHash: HASH })).toContain(`'sha256-${HASH}'`)
  })

  it('has no place on a printed page', () => {
    expect(mailContentCsp({ surface: 'print', allowRemoteImages: false, scriptHash: HASH })).not.toContain(
      'script-src'
    )
  })

  it('leaves scripts forbidden outright when there is nothing to permit', () => {
    expect(mailContentCsp(READER)).not.toContain('script-src')
  })

  it.each([
    ['a directive smuggled behind the digest', "abc'; script-src *; x '"],
    ['a wildcard', '*'],
    ['a source expression', "'unsafe-inline'"],
    ['the wrong length', 'K3n1Zb8='],
    ['an empty string', '']
  ])('refuses %s in place of a digest', (_name, hash) => {
    // No script-src at all means the rejected value reached nothing: scripts stay forbidden by
    // default-src, and there is no directive for it to have been written into.
    const csp = mailContentCsp({ ...READER, scriptHash: hash })
    expect(csp).not.toContain('script-src')
    expect(csp).not.toContain('sha256-')
  })
})
