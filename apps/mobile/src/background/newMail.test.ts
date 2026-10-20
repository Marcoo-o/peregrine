import { describe, expect, it } from 'vitest'
import { addAccount } from '../accounts'
import { syncFolders } from '../folders'
import { saveMessages } from '../messages'
import { migratedDatabase } from '../testing/testDb'
import { account } from '../testing/appHarness'
import { inboxBaselines, newMessagesSince } from './newMail'

const fetched = (uid: number, flags: string[] = []) => ({
  uid,
  flags,
  size: 10,
  hasAttachment: false,
  envelope: { subject: `s${uid}`, date: new Date(1000 + uid), from: [{ address: 'a@example.net' }] }
})

/** The role the server names for the inbox. */
const INBOX_ROLE = '\\Inbox'

const entry = (path: string, specialUse: string | null = null) => ({
  path,
  name: path,
  parentPath: null,
  flags: [],
  specialUse
})

async function mailbox() {
  const { db } = await migratedDatabase()
  const work = await addAccount(db, account('work'), { now: 1 })
  const [inbox, sent] = await syncFolders(db, work.id, [entry('INBOX', '\\Inbox'), entry('Sent', '\\Sent')])
  return { db, work, inbox, sent }
}

describe('what is known of the inboxes', () => {
  it('is the highest UID of each inbox, 0 for an empty one, and nothing for other folders', async () => {
    const { db, work, inbox, sent } = await mailbox()
    await saveMessages(db, sent, [fetched(40)])
    expect((await inboxBaselines(db)).get(inbox.id)).toBe(0)
    expect((await inboxBaselines(db)).has(sent.id)).toBe(false)

    await saveMessages(db, inbox, [fetched(3), fetched(7), fetched(5)])
    expect([...(await inboxBaselines(db)).entries()]).toEqual([[inbox.id, 7]])
    expect(work.id).toBeTruthy()
  })

  it('takes a folder called INBOX for an inbox though the server named no role', async () => {
    const { db, work } = await mailbox()
    const [plain] = await syncFolders(db, work.id, [entry('inbox')])
    expect((await inboxBaselines(db)).has(plain.id)).toBe(true)
  })
})

describe('the new messages', () => {
  it('are those with a higher UID than the inbox had that are not read', async () => {
    const { db, work, inbox } = await mailbox()
    await saveMessages(db, inbox, [fetched(1), fetched(2)])
    const baselines = await inboxBaselines(db)

    await saveMessages(db, inbox, [fetched(3), fetched(4, ['\\Seen']), fetched(5, ['\\Flagged'])])

    const found = await newMessagesSince(db, baselines)
    expect(found.map((m) => m.uid)).toEqual([3, 5])
    expect(found[0]).toEqual({
      accountId: work.id,
      accountName: 'work',
      folderId: inbox.id,
      uid: 3,
      sender: 'a@example.net',
      subject: 's3'
    })
  })

  it('are none when nothing came after the baseline, which includes what was there and unread', async () => {
    const { db, inbox } = await mailbox()
    await saveMessages(db, inbox, [fetched(1), fetched(2)])
    expect(await newMessagesSince(db, await inboxBaselines(db))).toEqual([])
  })

  it('are all of the messages that came into an inbox that was empty', async () => {
    const { db, inbox } = await mailbox()
    const baselines = await inboxBaselines(db)
    await saveMessages(db, inbox, [fetched(1), fetched(2)])
    expect((await newMessagesSince(db, baselines)).map((m) => m.uid)).toEqual([1, 2])
  })

  // A mailbox that was just added would otherwise announce every message it has.
  it('are none in a folder that was not known before, whatever it holds', async () => {
    const { db, work, inbox } = await mailbox()
    await saveMessages(db, inbox, [fetched(1)])
    const baselines = await inboxBaselines(db)

    const other = await addAccount(db, account('home'), { now: 2 })
    const [homeInbox] = await syncFolders(db, other.id, [entry('INBOX', '\\Inbox')])
    await saveMessages(db, homeInbox, [fetched(1), fetched(2)])

    expect(await newMessagesSince(db, baselines)).toEqual([])
    expect(work.id).toBeTruthy()
  })

  it('are not found in other folders than the inbox', async () => {
    const { db, sent } = await mailbox()
    const baselines = await inboxBaselines(db)
    await saveMessages(db, sent, [fetched(1)])
    expect(await newMessagesSince(db, baselines)).toEqual([])
  })
})

describe('the order of the new messages', () => {
  // The ids of folders are made at random, so an order that came from them would change from run to run.
  // Here the account that was made first has the folder whose id sorts last.
  it('is the order of the accounts, as the list shows them, and then of the UIDs', async () => {
    const { db } = await migratedDatabase()
    const first = await addAccount(db, account('first'), { now: 1 })
    const second = await addAccount(db, account('second'), { now: 2 })
    const [inboxFirst] = await syncFolders(db, first.id, [entry('INBOX', INBOX_ROLE)], () => 'z-inbox')
    const [inboxSecond] = await syncFolders(db, second.id, [entry('INBOX', INBOX_ROLE)], () => 'a-inbox')
    const baselines = await inboxBaselines(db)
    await saveMessages(db, inboxSecond, [fetched(1)])
    await saveMessages(db, inboxFirst, [fetched(2), fetched(1)])

    const found = await newMessagesSince(db, baselines)

    expect(found.map((m) => [m.accountName, m.uid])).toEqual([
      ['first', 1],
      ['first', 2],
      ['second', 1]
    ])
  })
})
