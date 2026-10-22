import { describe, expect, it } from 'vitest'
import type { ImapSession } from '@peregrine/core/imapSession'
import type { ComposeInput } from '@peregrine/core/types'
import { addAccount } from './accounts'
import { saveDraft } from './drafts'
import { syncFolders } from './folders'
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
    const uid = await saveDraft(db, undefined, imap, input(added.id))
    expect(uid).toBe(42)
    expect(appended).toHaveLength(1)
    expect(appended[0].path).toBe('Entwuerfe')
    expect(appended[0].flags).toEqual(['\\Draft', '\\Seen'])
    expect(appended[0].source).toContain('Subject: Plan')
    expect(appended[0].source).toContain('anna@example.net')
    expect(appended[0].source).toContain('From: Work <work@example.org>')
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
