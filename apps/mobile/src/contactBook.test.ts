import { describe, expect, it } from 'vitest'
import {
  addressProblem,
  findBookContact,
  getBookContact,
  importVcards,
  listBook,
  matchBook,
  removeContact,
  saveContact,
  toVcards,
  type BookContact
} from './contactBook'
import { migratedDatabase } from './testing/testDb'

const saved = (result: Awaited<ReturnType<typeof saveContact>>): BookContact => {
  if ('problem' in result) throw new Error(result.problem)
  return result.saved
}

describe('the contacts the user keeps', () => {
  it('are none to begin with, and are listed by name, and by address for those without one, without regard to case', async () => {
    const { db } = await migratedDatabase()
    expect(await listBook(db)).toEqual([])
    await saveContact(db, { name: 'zoe', address: 'z@example.net' })
    await saveContact(db, { name: '', address: 'b@example.net' })
    await saveContact(db, { name: 'Anna', address: 'a@example.net' })
    expect((await listBook(db)).map((contact) => contact.address)).toEqual(['a@example.net', 'b@example.net', 'z@example.net'])
  })

  it('are kept with the name on one line, and found by their address whatever the case', async () => {
    const { db } = await migratedDatabase()
    const kim = saved(await saveContact(db, { name: '  Kim   Example ', address: ' Kim@Example.net ' }))
    expect(kim).toMatchObject({ name: 'Kim Example', address: 'Kim@Example.net' })
    expect(await findBookContact(db, 'kim@example.NET')).toEqual(kim)
    expect(await getBookContact(db, kim.id)).toEqual(kim)
    expect(await getBookContact(db, 'nobody')).toBeUndefined()
  })

  it('are not kept for what is no address', async () => {
    const { db } = await migratedDatabase()
    for (const bad of ['', 'kim', 'kim@', '@example.net', 'kim@example', 'a b@example.net', 'a@b@example.net']) {
      expect(addressProblem(bad)).not.toBeNull()
      expect(await saveContact(db, { name: 'x', address: bad })).toEqual({ problem: 'Das ist keine E-Mail-Adresse.' })
    }
    expect(addressProblem('kim.o+tag@mail.example.co.uk')).toBeNull()
    expect(await listBook(db)).toEqual([])
  })

  it('are not kept twice for one address: the one that is there is the answer, and it takes the name when it had none', async () => {
    const { db } = await migratedDatabase()
    const first = saved(await saveContact(db, { name: '', address: 'kim@example.net' }))
    const again = saved(await saveContact(db, { name: 'Kim', address: 'KIM@example.net' }))
    expect(again.id).toBe(first.id)
    expect(again.name).toBe('Kim')
    expect(await listBook(db)).toHaveLength(1)
    const kept = saved(await saveContact(db, { name: '', address: 'kim@example.net' }))
    expect(kept.name).toBe('Kim')
  })

  it('can be changed in name and address, and not to the address of another', async () => {
    const { db } = await migratedDatabase()
    const kim = saved(await saveContact(db, { name: 'Kim', address: 'kim@example.net' }))
    const lee = saved(await saveContact(db, { name: 'Lee', address: 'lee@example.net' }))
    expect(saved(await saveContact(db, { name: 'Kim B', address: 'kim.b@example.net' }, kim.id))).toMatchObject({ name: 'Kim B', address: 'kim.b@example.net' })
    expect(await saveContact(db, { name: 'x', address: 'LEE@example.net' }, kim.id)).toEqual({ problem: 'Diese Adresse gehört schon zu einem anderen Kontakt.' })
    expect(saved(await saveContact(db, { name: 'Lee Z', address: 'lee@example.net' }, lee.id)).name).toBe('Lee Z')
    expect(await saveContact(db, { name: 'x', address: 'x@example.net' }, 'gone')).toEqual({ problem: 'Den Kontakt gibt es nicht mehr.' })
  })

  it('can be taken away, once', async () => {
    const { db } = await migratedDatabase()
    const kim = saved(await saveContact(db, { name: 'Kim', address: 'kim@example.net' }))
    expect(await removeContact(db, kim.id)).toBe(true)
    expect(await removeContact(db, kim.id)).toBe(false)
  })
})

describe('what is looked through for a typed part', () => {
  const book: BookContact[] = [
    { id: '1', name: 'Anna Beispiel', address: 'a@example.net' },
    { id: '2', name: '', address: 'bob@example.net' },
    { id: '3', name: 'Cara', address: 'cara@sender.test' }
  ]

  it('is every contact for nothing typed, and what has the part in the address or begins a word of the name for the rest', () => {
    expect(matchBook(book, '  ')).toHaveLength(3)
    expect(matchBook(book, 'bei').map((c) => c.id)).toEqual(['1'])
    expect(matchBook(book, 'SENDER').map((c) => c.id)).toEqual(['3'])
    expect(matchBook(book, 'nna')).toEqual([])
    expect(matchBook(book, 'bob').map((c) => c.id)).toEqual(['2'])
  })
})

describe('vCard in and out', () => {
  it('takes the cards of a file as contacts, and says how many were new, known and left out', async () => {
    const { db } = await migratedDatabase()
    await saveContact(db, { name: '', address: 'kim@example.net' })
    const file = [
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Kim Example', 'EMAIL:kim@example.net', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Lee Example', 'EMAIL:lee@example.net', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:No Address', 'END:VCARD'
    ].join('\r\n')
    const counts = await importVcards(db, file)
    expect(counts.added).toBe(1)
    expect(counts.known).toBe(1)
    const all = await listBook(db)
    expect(all.map((c) => c.address).sort()).toEqual(['kim@example.net', 'lee@example.net'])
    // the contact that was there without a name has the name of the card now
    expect(all.find((c) => c.address === 'kim@example.net')?.name).toBe('Kim Example')
  })

  it('does not change the name of a contact that has one, and is nothing for a file that holds no card', async () => {
    const { db } = await migratedDatabase()
    await saveContact(db, { name: 'Mine', address: 'kim@example.net' })
    await importVcards(db, ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Theirs', 'EMAIL:kim@example.net', 'END:VCARD'].join('\r\n'))
    expect((await listBook(db))[0].name).toBe('Mine')
    expect(await importVcards(db, 'just some text')).toEqual({ added: 0, known: 0, skipped: 0 })
  })

  it('writes the contacts as a file that reads back as the same', async () => {
    const { db } = await migratedDatabase()
    await saveContact(db, { name: 'Kim Example', address: 'kim@example.net' })
    await saveContact(db, { name: 'Lee, Z', address: 'lee@example.net' })
    const text = toVcards(await listBook(db))
    expect(text).toContain('BEGIN:VCARD')
    const other = (await migratedDatabase()).db
    await importVcards(other, text)
    expect((await listBook(other)).map((c) => [c.name, c.address])).toEqual([['Kim Example', 'kim@example.net'], ['Lee, Z', 'lee@example.net']])
  })
})
