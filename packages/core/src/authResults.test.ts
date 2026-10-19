import { describe, expect, it } from 'vitest'
import { failedChecks, parseAuthenticationResults } from './authResults'

describe('parseAuthenticationResults', () => {
  it('reads all three verdicts', () => {
    const header =
      'mx.example.com; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com'
    expect(parseAuthenticationResults(header)).toEqual({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass'
    })
  })

  it('reads a failure', () => {
    expect(parseAuthenticationResults('mx.example.com; spf=fail; dmarc=fail').spf).toBe('fail')
  })

  // Every relay may append one and a forged mail can carry any number of self-written ones;
  // the receiving server puts its own on top.
  it('only trusts the topmost header', () => {
    const header = 'mx.example.com; dmarc=fail\nevil.example; dmarc=pass'
    expect(parseAuthenticationResults(header).dmarc).toBe('fail')
  })

  it('reports missing methods as unknown rather than as a pass', () => {
    expect(parseAuthenticationResults('mx.example.com; spf=pass').dmarc).toBe('unknown')
  })

  it('survives an absent header', () => {
    expect(parseAuthenticationResults(null)).toEqual({
      spf: 'unknown',
      dkim: 'unknown',
      dmarc: 'unknown'
    })
  })

  it('does not mistake a value it does not know for a verdict', () => {
    expect(parseAuthenticationResults('x; dmarc=temperror').dmarc).toBe('unknown')
  })
})

describe('failedChecks', () => {
  it('stays quiet when everything passed', () => {
    expect(failedChecks({ spf: 'pass', dkim: 'pass', dmarc: 'pass' })).toEqual([])
  })

  it('stays quiet when the checks did not run', () => {
    expect(failedChecks({ spf: 'unknown', dkim: 'none', dmarc: 'unknown' })).toEqual([])
  })

  it('lists failures with dmarc first, as the one that subsumes the others', () => {
    expect(failedChecks({ spf: 'fail', dkim: 'pass', dmarc: 'fail' })).toEqual(['dmarc', 'spf'])
  })

  it('counts a softfail as a failure', () => {
    expect(failedChecks({ spf: 'softfail', dkim: 'pass', dmarc: 'unknown' })).toEqual(['spf'])
  })
})
