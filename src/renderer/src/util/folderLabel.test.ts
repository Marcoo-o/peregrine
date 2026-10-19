import { describe, expect, it } from 'vitest'
import type { AccountSummary } from '@peregrine/core/types'
import { accountLabel, accountTitle } from './folderLabel'

function account(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'a1',
    displayName: 'John',
    emailAddress: 'john@peregrine.example',
    imapHost: 'imap.example.org',
    imapPort: 993,
    imapSecure: 'tls',
    imapUsername: 'john',
    smtpHost: 'smtp.example.org',
    smtpPort: 465,
    smtpSecure: 'tls',
    smtpUsername: 'john',
    authType: 'password',
    sortOrder: 0,
    signature: '',
    color: '#2f5d9f',
    encryptByDefault: false,
    ...overrides
  }
}

describe('accountLabel', () => {
  /**
   * The finding behind this. `displayName` is the sender name and the same across all
   * accounts, rightly so, because it is the same person. In the sidebar that left nine visibly
   * identical rows underneath each other.
   */
  it('tells twelve mailboxes of the same person apart', () => {
    const accounts = [
      account({ id: '1', emailAddress: 'john@peregrine.example' }),
      account({ id: '2', emailAddress: 'finanzen@peregrine.example' }),
      account({ id: '3', emailAddress: 'alex@peregrine.example', displayName: 'John D.' })
    ]
    const labels = accounts.map(accountLabel)
    expect(new Set(labels).size).toBe(3)
    // And none of them is the person's name, which would have been the same for all three.
    expect(labels).not.toContain('John')
  })

  // An account without an address does not exist after setup, but an empty row in the sidebar
  // would be worse than the sender name.
  it('falls back to the sender name rather than showing nothing', () => {
    expect(accountLabel(account({ emailAddress: '' }))).toBe('John')
  })
})

describe('accountTitle', () => {
  it('keeps the sender name reachable, just not as the label', () => {
    expect(accountTitle(account())).toBe('John <john@peregrine.example>')
  })

  // A tooltip that repeats the label is noise.
  it('says nothing when there is nothing to add', () => {
    expect(accountTitle(account({ displayName: '' }))).toBeUndefined()
    expect(accountTitle(account({ displayName: 'john@peregrine.example' }))).toBeUndefined()
  })
})
