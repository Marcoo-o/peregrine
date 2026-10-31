import { describe, expect, it } from 'vitest'
import { listBook, saveContact } from '../contactBook'
import { saveListSettings } from '../settings'
import { appHarness } from '../testing/appHarness'
import { readable } from '../testing/readable'
import type { ContactsState, MessageState } from './screens'

async function onContacts() {
  const t = await appHarness()
  await t.givenAccount('work', {})
  await t.app.contacts.show()
  const shown = () => t.store.screen as ContactsState
  return { ...t, shown }
}

const vcard = (...cards: Array<[string, string]>) =>
  cards.map(([name, email]) => ['BEGIN:VCARD', 'VERSION:3.0', `FN:${name}`, `EMAIL:${email}`, 'END:VCARD'].join('\r\n')).join('\r\n')

describe('the screen for the contacts', () => {
  it('has none to begin with, and goes back to the settings', async () => {
    const t = await onContacts()
    expect(t.shown()).toMatchObject({ name: 'contacts', contacts: [] })
  })

  it('keeps a contact, says so, and lists it', async () => {
    const t = await onContacts()
    await t.app.contacts.save(null, { name: 'Kim', address: 'kim@example.net' })
    expect(t.shown()).toMatchObject({ notice: 'Gespeichert.', contacts: [{ name: 'Kim', address: 'kim@example.net' }] })
  })

  it('says why it did not keep what is no address, or an address another contact has, and keeps nothing', async () => {
    const t = await onContacts()
    await t.app.contacts.save(null, { name: 'x', address: 'not an address' })
    expect(t.shown()).toMatchObject({ error: 'Das ist keine E-Mail-Adresse.', contacts: [] })
    await t.app.contacts.save(null, { name: 'Kim', address: 'kim@example.net' })
    await t.app.contacts.save(null, { name: 'Lee', address: 'lee@example.net' })
    const [kim] = t.shown().contacts
    await t.app.contacts.save(kim.id, { name: 'Kim', address: 'LEE@example.net' })
    expect(t.shown().error).toContain('anderen Kontakt')
  })

  it('changes a contact, and takes one away', async () => {
    const t = await onContacts()
    await t.app.contacts.save(null, { name: 'Kim', address: 'kim@example.net' })
    const [kim] = t.shown().contacts
    await t.app.contacts.save(kim.id, { name: 'Kim Example', address: 'kim@example.net' })
    expect(t.shown().contacts[0].name).toBe('Kim Example')
    await t.app.contacts.remove(kim.id)
    expect(t.shown()).toMatchObject({ contacts: [], notice: 'Der Kontakt ist entfernt.' })
  })
})

describe('the sender of a message as a contact', () => {
  it('is kept, with the name the message gives, and said on the message', async () => {
    const t = await onContacts()
    const state: MessageState = { name: 'message', account: undefined as never, folder: undefined as never, summary: undefined as never, origin: 'folder', message: readable({ from: 'Anna <anna@example.net>' }) }
    t.store.showScreen(state)
    await t.app.messages.addSenderToContacts(state)
    expect(await listBook(t.db)).toMatchObject([{ name: 'Anna', address: 'anna@example.net' }])
    expect(t.store.screen).toMatchObject({ notice: 'Anna ist bei den Kontakten.' })
    await t.app.messages.addSenderToContacts(t.store.screen as MessageState)
    expect(await listBook(t.db)).toHaveLength(1)
  })

  it('is nothing before the message has arrived', async () => {
    const t = await onContacts()
    await t.app.messages.addSenderToContacts({ name: 'message', account: undefined as never, folder: undefined as never, summary: undefined as never, origin: 'folder' })
    expect(await listBook(t.db)).toEqual([])
  })
})

describe('a vCard file in and out', () => {
  it('is read from the file the user picks, and says how many came, and the copy of the file is removed', async () => {
    const t = await onContacts()
    await saveContact(t.db, { name: 'Kim', address: 'kim@example.net' })
    const text = vcard(['Kim', 'kim@example.net'], ['Lee', 'lee@example.net'])
    t.files.picked.push({ path: '/store/1/c.vcf', name: 'c.vcf', size: text.length, contentType: 'text/vcard' })
    t.files.stored.set('/store/1/c.vcf', new TextEncoder().encode(text))
    await t.app.contacts.importFile()
    expect(t.shown().notice).toBe('Übernommen: 1 neu, 1 schon da.')
    expect(t.shown().contacts.map((c) => c.address).sort()).toEqual(['kim@example.net', 'lee@example.net'])
    expect(t.files.removed).toContain('/store/1/c.vcf')
  })

  it('says that a file without a card has none, that one that is too large is too large, and does nothing when no file was picked', async () => {
    const t = await onContacts()
    await t.app.contacts.importFile()
    expect(t.shown().notice).toBeUndefined()
    t.files.picked.push({ path: '/store/2/x.txt', name: 'x.txt', size: 3, contentType: 'text/plain' })
    t.files.stored.set('/store/2/x.txt', new TextEncoder().encode('abc'))
    await t.app.contacts.importFile()
    expect(t.shown().error).toContain('keine Visitenkarte')
    t.files.picked.length = 0
    t.files.picked.push({ path: '/store/3/big.vcf', name: 'big.vcf', size: 6 * 1024 * 1024, contentType: 'text/vcard' })
    await t.app.contacts.importFile()
    expect(t.shown().error).toContain('zu groß')
  })

  it('says why when the file could not be read', async () => {
    const t = await onContacts()
    t.files.picked.push({ path: '/store/9/missing.vcf', name: 'missing.vcf', size: 10, contentType: 'text/vcard' })
    await t.app.contacts.importFile()
    expect(t.shown().error).toContain('nicht lesen')
  })

  it('writes all the contacts, or one, to a file where the user chooses', async () => {
    const t = await onContacts()
    await saveContact(t.db, { name: 'Kim Example', address: 'kim@example.net' })
    await saveContact(t.db, { name: 'Lee', address: 'lee@example.net' })
    await t.app.contacts.show()
    await t.app.contacts.exportFile()
    expect(t.files.saved.at(-1)?.name).toBe('kontakte.vcf')
    expect(new TextDecoder().decode(t.files.saved.at(-1)?.content)).toContain('kim@example.net')
    const [kim] = t.shown().contacts
    await t.app.contacts.exportFile(kim.id)
    expect(t.files.saved.at(-1)?.name).toBe('Kim Example.vcf')
    expect(new TextDecoder().decode(t.files.saved.at(-1)?.content)).not.toContain('lee@example.net')
  })

  it('says that there is nothing to write when there are no contacts, and why when saving failed', async () => {
    const t = await onContacts()
    await t.app.contacts.exportFile()
    expect(t.shown().error).toContain('keine Kontakte')
    await saveContact(t.db, { name: 'Kim', address: 'kim@example.net' })
    t.files.failWith = new Error('no space')
    await t.app.contacts.exportFile()
    expect(t.shown().error).toContain('no space')
  })
})

describe('the contacts that are suggested when an address is typed', () => {
  async function withBook() {
    const t = await appHarness()
    await t.givenAccount('work', { INBOX: [{ uid: 1 }] })
    await saveContact(t.db, { name: 'Kim Beispiel', address: 'kim@example.net' })
    await saveContact(t.db, { name: 'Alex Own', address: 'work@example.org' })
    return t
  }

  it('are those the user keeps, after the people the phone has mail from, without the accounts of the user', async () => {
    const t = await withBook()
    expect(await t.app.compose.suggest('e')).toEqual([
      { name: '', address: 'sender@example.net' },
      { name: 'Kim Beispiel', address: 'kim@example.net' }
    ])
    expect((await t.app.compose.suggest('own')).map((c) => c.address)).toEqual([])
  })

  it('keep the name the user gave over the one the address book of the device has', async () => {
    const t = await withBook()
    t.deviceContacts.allowed = true
    t.deviceContacts.people = [{ name: 'Kimmy from the phone', address: 'KIM@example.net' }]
    await saveListSettings(t.db, { deviceContacts: true })
    const found = await t.app.compose.suggest('kim')
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('Kim Beispiel')
    expect(found[0].address.toLowerCase()).toBe('kim@example.net')
  })

  it('are there without the address book of the device, which has to be switched on for that one', async () => {
    const t = await withBook()
    t.deviceContacts.allowed = true
    t.deviceContacts.people = [{ name: 'Only on the phone', address: 'phone@example.net' }]
    expect((await t.app.compose.suggest('phone')).map((c) => c.address)).toEqual([])
    expect((await t.app.compose.suggest('kim')).map((c) => c.address)).toEqual(['kim@example.net'])
  })
})
