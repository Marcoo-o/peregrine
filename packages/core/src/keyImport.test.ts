import { describe, expect, it } from 'vitest'
import {
  addressesFromUserIds,
  assignKeys,
  isImportable,
  type AccountAddress,
  type ScannedKey
} from './keyImport'

const NOW = new Date('2026-08-08T12:00:00Z')

function key(overrides: Partial<ScannedKey> & { fingerprint: string }): ScannedKey {
  return {
    userIds: [],
    addresses: [],
    hasPrivate: true,
    privateUnlocked: true,
    createdAt: '2025-11-05T00:00:00Z',
    expiresAt: null,
    ...overrides
  }
}

const accounts: AccountAddress[] = [
  { id: 'acc-john', emailAddress: 'john@peregrine.example' },
  { id: 'acc-alex', emailAddress: 'alex@peregrine.example' }
]

describe('addressesFromUserIds', () => {
  it('pulls the address out of a full user ID', () => {
    expect(addressesFromUserIds(['John <john@peregrine.example>'])).toEqual([
      'john@peregrine.example'
    ])
  })

  it('accepts a bare address', () => {
    expect(addressesFromUserIds(['alex@peregrine.example'])).toEqual(['alex@peregrine.example'])
  })

  // Case is the sender's choice; the mapping must not be.
  it('lower-cases and drops repeats', () => {
    expect(addressesFromUserIds(['A <John@peregrine.example>', 'B <john@peregrine.example>'])).toEqual([
      'john@peregrine.example'
    ])
  })

  it('ignores a user ID without an address', () => {
    expect(addressesFromUserIds(['John (Arbeit)'])).toEqual([])
  })
})

describe('assignKeys', () => {
  it('files a key under the account carrying its address', () => {
    const [assignment] = assignKeys(
      [key({ fingerprint: 'aaa', addresses: ['john@peregrine.example'] })],
      accounts,
      { now: NOW }
    )
    expect(assignment.accountIds).toEqual(['acc-john'])
    expect(assignment.contactAddress).toBeNull()
  })

  it('files a stranger under their address as a contact key', () => {
    const [assignment] = assignKeys(
      [key({ fingerprint: 'bbb', addresses: ['someone@example.org'], hasPrivate: false })],
      accounts,
      { now: NOW }
    )
    expect(assignment.accountIds).toEqual([])
    expect(assignment.contactAddress).toBe('someone@example.org')
    expect(isImportable(assignment)).toBe(true)
  })

  // One key can carry several of the user's own addresses; both accounts should get it.
  it('reaches every account whose address the key carries', () => {
    const [assignment] = assignKeys(
      [key({ fingerprint: 'ccc', addresses: ['john@peregrine.example', 'alex@peregrine.example'] })],
      accounts,
      { now: NOW }
    )
    expect(assignment.accountIds).toEqual(['acc-john', 'acc-alex'])
  })

  it('notes a sealed private key', () => {
    const [assignment] = assignKeys(
      [key({ fingerprint: 'ddd', addresses: ['john@peregrine.example'], privateUnlocked: false })],
      accounts,
      { now: NOW }
    )
    expect(assignment.notes).toContain('locked')
  })

  it('notes an expired key but keeps it importable - old mail stays encrypted to it', () => {
    const [assignment] = assignKeys(
      [
        key({
          fingerprint: 'eee',
          addresses: ['john@peregrine.example'],
          expiresAt: '2026-01-01T00:00:00Z'
        })
      ],
      accounts,
      { now: NOW }
    )
    expect(assignment.notes).toContain('expired')
    expect(isImportable(assignment)).toBe(true)
  })

  it('notes a key that is already stored, whatever the case of the fingerprint', () => {
    const [assignment] = assignKeys(
      [key({ fingerprint: 'ABC123', addresses: ['john@peregrine.example'] })],
      accounts,
      { knownFingerprints: ['abc123'], now: NOW }
    )
    expect(assignment.notes).toContain('alreadyPresent')
    expect(isImportable(assignment)).toBe(false)
  })

  // A public key for one's own address cannot decrypt anything addressed to it.
  it('rejects a public-only key that matches an account', () => {
    const [assignment] = assignKeys(
      [key({ fingerprint: 'fff', addresses: ['john@peregrine.example'], hasPrivate: false })],
      accounts,
      { now: NOW }
    )
    expect(assignment.notes).toContain('publicOnly')
    expect(isImportable(assignment)).toBe(false)
  })

  it('does not call a stranger’s public key public-only', () => {
    const [assignment] = assignKeys(
      [key({ fingerprint: 'ggg', addresses: ['someone@example.org'], hasPrivate: false })],
      accounts,
      { now: NOW }
    )
    expect(assignment.notes).not.toContain('publicOnly')
  })

  // An account holds a ring, so both belong in it. But only one of them can sign.
  it('marks both keys when two belong to the same account, and takes both', () => {
    const assignments = assignKeys(
      [
        key({ fingerprint: 'h1', addresses: ['john@peregrine.example'] }),
        key({ fingerprint: 'h2', addresses: ['john@peregrine.example'] })
      ],
      accounts,
      { now: NOW }
    )
    expect(assignments.map((a) => a.notes)).toEqual([
      ['severalForOneAccount'],
      ['severalForOneAccount']
    ])
    expect(assignments.every(isImportable)).toBe(true)
  })

  it('leaves untouched accounts out of that note', () => {
    const assignments = assignKeys(
      [
        key({ fingerprint: 'i1', addresses: ['john@peregrine.example'] }),
        key({ fingerprint: 'i2', addresses: ['john@peregrine.example'] }),
        key({ fingerprint: 'i3', addresses: ['alex@peregrine.example'] })
      ],
      accounts,
      { now: NOW }
    )
    expect(assignments[2].notes).toEqual([])
    expect(isImportable(assignments[2])).toBe(true)
  })

  it('has nothing to file for a key without any address', () => {
    const [assignment] = assignKeys([key({ fingerprint: 'jjj' })], accounts, { now: NOW })
    expect(assignment.contactAddress).toBeNull()
    expect(isImportable(assignment)).toBe(false)
  })
})

/**
 * Thunderbird seals private keys with a passphrase it generates itself and never shows. Those
 * keys must not be offered as if typing something could open them.
 */
describe('assignKeys without a reachable passphrase', () => {
  const sealed = (address: string): ScannedKey =>
    key({ fingerprint: 'k-' + address, addresses: [address], privateUnlocked: false })

  it('will not take a sealed key onto an account of one’s own', () => {
    const [assignment] = assignKeys([sealed('john@peregrine.example')], accounts, {
      passphraseAvailable: false,
      now: NOW
    })
    expect(assignment.notes).toContain('sealedExternally')
    expect(assignment.notes).not.toContain('locked')
    expect(isImportable(assignment)).toBe(false)
  })

  // The public half of a stranger's key is all a contact key ever needs, so the warning would
  // sit on a row that imports perfectly well.
  it('still takes a sealed key over as a contact key, and says nothing about the seal', () => {
    const [assignment] = assignKeys([sealed('someone@example.org')], accounts, {
      passphraseAvailable: false,
      now: NOW
    })
    expect(assignment.contactAddress).toBe('someone@example.org')
    expect(assignment.notes).toEqual([])
    expect(isImportable(assignment)).toBe(true)
  })

  it('says nothing about a passphrase for a contact key either', () => {
    const [assignment] = assignKeys([sealed('someone@example.org')], accounts, {
      passphraseAvailable: true,
      now: NOW
    })
    expect(assignment.notes).toEqual([])
  })

  it('asks for the passphrase when the user can actually supply it', () => {
    const [assignment] = assignKeys([sealed('john@peregrine.example')], accounts, {
      passphraseAvailable: true,
      now: NOW
    })
    expect(assignment.notes).toContain('locked')
    expect(isImportable(assignment)).toBe(true)
  })
})
