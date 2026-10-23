import { describe, expect, it } from 'vitest'
import type { FetchedMessage, ImapSession } from '@peregrine/core/imapSession'
import type { ComposeInput } from '@peregrine/core/types'
import { addAccount } from './accounts'
import { draftsFolderOf, keepQueuedDraft, saveDraft } from './drafts'
import { syncFolders } from './folders'
import { listMessages, saveMessages } from './messages'
import { migratedDatabase } from './testing/testDb'

const input = (accountId: string, over: Partial<ComposeInput> = {}): ComposeInput => ({
  accountId,
  to: [{ name: 'Anna', address: 'anna@example.net' }],
  cc: [],
  bcc: [],
  subject: 'Plan',
  textBody: 'Not finished',
  htmlBody: '',
  attachments: [],
  ...over
})

async function account(over: { drafts: boolean; emailAddress?: string } = { drafts: true }) {
  const { db } = await migratedDatabase()
  const added = await addAccount(
    db,
    {
      displayName: 'Work',
      emailAddress: over.emailAddress ?? 'work@example.org',
      imapHost: 'imap.example.org',
      imapPort: 993,
      imapSecure: 'tls',
      imapUsername: 'work',
      smtpHost: 'smtp.example.org',
      smtpPort: 587,
      smtpSecure: 'starttls',
      smtpUsername: null,
      password: 'secret',
      smtpPassword: null
    },
    { now: 1 }
  )
  const entry = (path: string, specialUse: string | null) => ({ path, name: path, parentPath: null, flags: [], specialUse })
  await syncFolders(db, added.id, [
    entry('INBOX', '\\Inbox'),
    ...(over.drafts ? [entry('Entwuerfe', '\\Drafts')] : [])
  ])
  const appended: Array<{ path: string; source: string; flags: string[] | undefined }> = []
  const imap = {
    appendMessage: async (path: string, source: Uint8Array | string, flags?: string[]) => {
      appended.push({ path, source: typeof source === 'string' ? source : new TextDecoder().decode(source), flags })
      return 42
    }
  } as unknown as ImapSession
  return { db, added, imap, appended }
}

describe('keeping a message as a draft', () => {
  it('puts it in the drafts folder of the account, marked as a draft and as read, and returns the UID it got', async () => {
    const { db, added, imap, appended } = await account()
    const kept = await saveDraft(db, undefined, imap, input(added.id))
    expect(kept.uid).toBe(42)
    expect(kept.folder.imapPath).toBe('Entwuerfe')
    expect(appended).toHaveLength(1)
    expect(appended[0].path).toBe('Entwuerfe')
    expect(appended[0].flags).toEqual(['\\Draft', '\\Seen'])
    expect(appended[0].source).toContain('Subject: Plan')
    expect(appended[0].source).toContain('anna@example.net')
    expect(appended[0].source).toContain('From: Work <work@example.org>')
  })

  it('keeps the blind copy in the headers, which a message that is sent never has', async () => {
    const { db, added, imap, appended } = await account()
    await saveDraft(db, undefined, imap, input(added.id, { bcc: [{ name: 'Carl', address: 'carl@example.net' }] }))
    expect(appended[0].source).toMatch(/^Bcc: Carl <carl@example\.net>/m)
  })

  it('keeps a draft for nobody but a blind copy', async () => {
    const { db, added, imap, appended } = await account()
    await saveDraft(db, undefined, imap, input(added.id, { to: [], bcc: [{ name: '', address: 'carl@example.net' }] }))
    expect(appended[0].source).toMatch(/^Bcc: carl@example\.net/m)
    expect(appended[0].source).not.toMatch(/^To:/m)
  })

  it('keeps a draft that has nobody to go to yet, which is how one begins when the subject comes first', async () => {
    const { db, added, imap, appended } = await account()
    await saveDraft(db, undefined, imap, input(added.id, { to: [], subject: 'Not yet', textBody: 'Start' }))
    expect(appended[0].source).toContain('Subject: Not yet')
    expect(appended[0].source).not.toMatch(/^To:/m)
  })

  it('keeps what it needs of a thread', async () => {
    const { db, added, imap, appended } = await account()
    await saveDraft(db, undefined, imap, input(added.id, { inReplyTo: '<one@example.net>', references: '<zero@example.net> <one@example.net>' }))
    expect(appended[0].source).toContain('In-Reply-To: <one@example.net>')
    // A long header is folded onto the next line, which is still the same header.
    expect(appended[0].source).toMatch(/References: <zero@example\.net>\s+<one@example\.net>/)
  })

  it('says so, and keeps nothing, when the account has no folder for drafts', async () => {
    const { db, added, imap, appended } = await account({ drafts: false })
    await expect(saveDraft(db, undefined, imap, input(added.id))).rejects.toThrow('keinen Ordner für Entwürfe')
    expect(appended).toEqual([])
  })

  it('says so when the account has no address to write from', async () => {
    const { db, added, imap } = await account({ drafts: true, emailAddress: '' })
    await expect(saveDraft(db, undefined, imap, input(added.id))).rejects.toThrow('keine Absenderadresse')
  })

  it('refuses what it would keep in the clear that was meant not to be', async () => {
    const { db, added, imap, appended } = await account()
    await expect(saveDraft(db, undefined, imap, input(added.id, { encrypt: true }))).rejects.toThrow('Verschlüsseln und Signieren')
    await expect(saveDraft(db, undefined, imap, input(added.id, { sign: true }))).rejects.toThrow('Verschlüsseln und Signieren')
    expect(appended).toEqual([])
  })

  it('says so when the account is gone', async () => {
    const { db, imap } = await account()
    await expect(saveDraft(db, undefined, imap, input('gone'))).rejects.toThrow('gibt es nicht mehr')
  })
})

describe('keeping a draft that waited in the queue', () => {
  it('appends the new revision first and deletes the one it replaces after, from the server and from the phone', async () => {
    const { db, added, imap, appended } = await account()
    const deleted: Array<{ path: string; uids: number[] }> = []
    ;(imap as unknown as { deleteMessages: unknown }).deleteMessages = async (path: string, uids: number[]) => void deleted.push({ path, uids })
    const drafts = (await draftsFolderOf(db, added.id))!
    await saveMessages(db, drafts, [
      { uid: 7, envelope: { subject: 'Plan' }, flags: ['\\Draft'], size: 10, hasAttachment: false } as unknown as FetchedMessage
    ])
    const kept = await keepQueuedDraft(db, undefined, imap, {
      draftKey: 'writing-1',
      input: input(added.id),
      replace: { folderId: drafts.id, uid: 7 }
    })
    expect(kept.uid).toBe(42)
    expect(appended).toHaveLength(1)
    expect(deleted).toEqual([{ path: 'Entwuerfe', uids: [7] }])
    expect(await listMessages(db, drafts.id)).toEqual([])
  })

  it('deletes nothing when it replaces nothing', async () => {
    const { db, added, imap } = await account()
    const deleted: unknown[] = []
    ;(imap as unknown as { deleteMessages: unknown }).deleteMessages = async () => void deleted.push(1)
    await keepQueuedDraft(db, undefined, imap, { draftKey: 'writing-1', input: input(added.id) })
    expect(deleted).toEqual([])
  })

  it('keeps nothing of the old one when the new one could not be appended', async () => {
    const { db, added, imap } = await account()
    const deleted: unknown[] = []
    ;(imap as unknown as { appendMessage: unknown }).appendMessage = async () => {
      throw new Error('no space')
    }
    ;(imap as unknown as { deleteMessages: unknown }).deleteMessages = async () => void deleted.push(1)
    const drafts = (await draftsFolderOf(db, added.id))!
    await expect(
      keepQueuedDraft(db, undefined, imap, { draftKey: 'k', input: input(added.id), replace: { folderId: drafts.id, uid: 7 } })
    ).rejects.toThrow('no space')
    expect(deleted).toEqual([])
  })
})
