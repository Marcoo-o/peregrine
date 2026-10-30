import { describe, expect, it } from 'vitest'
import { listFolders } from './folders'
import { listMessages } from './messages'
import { appHarness } from './testing/appHarness'

describe('what a message says of the one it answers', () => {
  it('is kept with the message, and comes back in the list, and is nothing for a message that does not say', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', {
      INBOX: [
        { uid: 1, subject: 'Plan', messageId: '<1@example.net>' },
        { uid: 2, subject: 'Re: Plan', messageId: '<2@example.net>', inReplyTo: '<1@example.net>' },
        { uid: 3, subject: 'Alone' }
      ]
    })
    const inbox = (await listFolders(t.db, work.id)).find((folder) => folder.imapPath === 'INBOX')!
    const byUid = Object.fromEntries((await listMessages(t.db, inbox.id)).map((m) => [m.uid, m]))
    expect(byUid[1]).toMatchObject({ messageId: '<1@example.net>', inReplyTo: null })
    expect(byUid[2]).toMatchObject({ messageId: '<2@example.net>', inReplyTo: '<1@example.net>' })
    expect(byUid[3]).toMatchObject({ messageId: null, inReplyTo: null })
  })
})
