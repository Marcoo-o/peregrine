import { describe, expect, it } from 'vitest'
import { RnContacts, type NativeContacts } from './RnContacts'

function fakeNative(over: Partial<NativeContacts> = {}) {
  const calls: string[] = []
  const native: NativeContacts = {
    permitted: async () => true,
    ensurePermission: async () => true,
    search: async (typed, limit) => {
      calls.push(`search ${typed} ${limit}`)
      return [{ name: 'Kim', address: 'kim@example.net' }]
    },
    ...over
  }
  return { contacts: new RnContacts(native), calls }
}

describe('the address book of the device', () => {
  it('asks the native module for the people that match, as many as were asked for', async () => {
    const { contacts, calls } = fakeNative()
    expect(await contacts.search('ki', 4)).toEqual([{ name: 'Kim', address: 'kim@example.net' }])
    expect(calls).toEqual(['search ki 4'])
  })

  it('asks for nothing when nothing was typed', async () => {
    const { contacts, calls } = fakeNative()
    expect(await contacts.search('  ', 4)).toEqual([])
    expect(calls).toEqual([])
  })

  it('passes on whether it may be read, and the answer to being asked', async () => {
    const { contacts } = fakeNative({ permitted: async () => false, ensurePermission: async () => false })
    expect(await contacts.permitted()).toBe(false)
    expect(await contacts.ensurePermission()).toBe(false)
  })
})
