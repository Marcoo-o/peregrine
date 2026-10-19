import { describe, expect, it } from 'vitest'
import { toSecureFlag, toStartTlsFlag } from './ImapConnection'

/**
 * The two flags that decide whether the password travels in the clear.
 *
 * Worth a test of their own because the dangerous case is the quiet one: with STARTTLS left
 * optional, a connection to a stripped server succeeds, syncs mail and looks entirely normal
 * while having handed the password to whoever did the stripping.
 */
describe('toSecureFlag', () => {
  it('asks for implicit TLS only where TLS was chosen', () => {
    expect(toSecureFlag('tls')).toBe(true)
    expect(toSecureFlag('starttls')).toBe(false)
    expect(toSecureFlag('none')).toBe(false)
  })
})

describe('toStartTlsFlag', () => {
  it('makes the upgrade mandatory when STARTTLS was chosen', () => {
    expect(toStartTlsFlag('starttls')).toBe(true)
  })

  // imapflow rejects the combination outright, so this must not become true by accident.
  it('stays unset for implicit TLS, where an upgrade makes no sense', () => {
    expect(toStartTlsFlag('tls')).toBeUndefined()
  })

  // Not false: an upgrade offered by the server is still better than the plaintext that was
  // asked for, and switching it off would be a downgrade nobody requested.
  it('leaves the opportunistic upgrade in place when no encryption was chosen', () => {
    expect(toStartTlsFlag('none')).toBeUndefined()
  })
})
