import { describe, it } from 'vitest'
import type { FetchedMessage } from '@peregrine/core/imapSession'
import { suggestContacts } from '../contacts'
import { listMessages, saveMessages, unreadCounts } from '../messages'
import { FIRST_CONTACT_COUNT, isFirstContact, messagesFrom } from '../senderHistory'
import { searchMessages } from '../search'
import { tagCounts } from '../tags'
import { listUnified, unifiedCount, unifiedUnread } from '../unified'
import { buildMailbox, timed } from '../testing/perfMailbox'

/**
 * How the phone's database behaves with a large mailbox. It is not part of the normal run: it takes a while, and what it prints are timings, which depend on the
 * machine. Run it by hand:
 *
 *     PEREGRINE_PERF=1 npx vitest run apps/mobile/src/perf --reporter=verbose
 *     PEREGRINE_PERF=1 PEREGRINE_PERF_MESSAGES=250000 npx vitest run apps/mobile/src/perf --reporter=verbose
 *
 * It makes a mailbox of that many messages over two accounts (see `buildMailbox`) and times what the screens ask of the database. The database is SQLite
 * in memory on this machine, which is much faster than the phone's: what matters is how the times grow with the number of messages, and which are the ones
 * that grow. Every one of them reads the whole table, so every one grows in step with it.
 */
const enabled = process.env.PEREGRINE_PERF === '1'
const TOTAL = Number(process.env.PEREGRINE_PERF_MESSAGES ?? 100_000)

describe.skipIf(!enabled)('a mailbox of many messages', () => {
  it(`has ${TOTAL} messages, and what the screens ask of it takes`, async () => {
    const { db, accounts, inbox, madeInMs } = await buildMailbox(TOTAL)
    const lines = [`made ${TOTAL} messages in ${madeInMs.toFixed(0)} ms`]
    const measure = async (name: string, work: () => Promise<unknown>, runs = 3): Promise<void> => {
      const { ms, result } = await timed(work, runs)
      lines.push(`${name.padEnd(48)} ${ms.toFixed(1).padStart(9)} ms${Array.isArray(result) ? ` (${result.length} rows)` : ''}`)
    }

    await measure('list of a folder (listMessages)', () => listMessages(db, inbox.id))
    await measure('unread counts of an account', () => unreadCounts(db, accounts[0].id))
    await measure('unread counts of all roles (unifiedUnread)', () => unifiedUnread(db))
    await measure('the unified inbox (listUnified)', () => listUnified(db))
    await measure('how many in the unified inbox', () => unifiedCount(db))
    await measure('search for a word of the subject', () => searchMessages(db, 'planning'))
    await measure('search for a word that is in no message', () => searchMessages(db, 'zzzqqq'))
    await measure('search in the text', () => searchMessages(db, 'budget'))
    await measure('suggest an address as three letters are typed', () => suggestContacts(db, 'per'))
    await measure('messages from a sender (first contact?)', async () => isFirstContact(await messagesFrom(db, 'person77@northwind37.test', FIRST_CONTACT_COUNT)))
    await measure('a first contact: the sender is not there at all', () => messagesFrom(db, 'nobody@nowhere.test', FIRST_CONTACT_COUNT))
    await measure('the number of messages of each tag', () => tagCounts(db))

    const fetched = Array.from({ length: 500 }, (_v, i) => ({
      uid: 900_000 + i,
      flags: [],
      size: 1000,
      hasAttachment: false,
      envelope: { subject: `New ${i}`, from: [{ name: 'New', address: 'new@northwind1.test' }], date: new Date(1_800_000_000_000 + i * 1000), messageId: `<new${i}@mail.test>` }
    })) as unknown as FetchedMessage[]
    await measure('save 500 fetched messages into the folder', () => saveMessages(db, { id: inbox.id, accountId: inbox.accountId }, fetched), 1)

    console.info(`\n${lines.join('\n')}\n`)
  }, 900_000)
})
