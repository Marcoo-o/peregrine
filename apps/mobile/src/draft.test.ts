import { describe, expect, it } from 'vitest'
import {
  attachPicked,
  detachFile,
  emptyDraft,
  hasRecipient,
  parseAddressList,
  forwardDraft,
  replyAllDraft,
  replyDraft,
  replySubject,
  splitAddressList,
  toComposeInput,
  type DraftAttachment
} from './draft'
import type { FileAccess, PickedFile } from './files'
import type { ReadableMessage } from './messageText'
import { readable } from './testing/readable'

const original = (over: Partial<ReadableMessage> = {}): ReadableMessage =>
  readable({ text: 'Shall we?\r\nAt noon.\r\n', messageId: '<two@example.net>', references: '<one@example.net>', ...over })

describe('a list of addresses as it is typed', () => {
  it('is split at commas and semicolons, but not inside a name in quotes or an address in brackets', () => {
    expect(splitAddressList('a@example.net, b@example.net; c@example.net')).toEqual(['a@example.net', 'b@example.net', 'c@example.net'])
    expect(splitAddressList('"Anna, B" <a@example.net>, c@example.net')).toEqual(['"Anna, B" <a@example.net>', 'c@example.net'])
    expect(splitAddressList('Anna <a@example.net,b@example.net>')).toEqual(['Anna <a@example.net,b@example.net>'])
  })

  it('has no empty entries from a trailing comma or a blank', () => {
    expect(splitAddressList(' ,a@example.net, ,')).toEqual(['a@example.net'])
    expect(splitAddressList('')).toEqual([])
  })

  it('is read into names and addresses', () => {
    expect(parseAddressList('Anna <a@example.net>, b@example.net')).toEqual([
      { name: 'Anna', address: 'a@example.net' },
      { name: '', address: 'b@example.net' }
    ])
  })

  it('tells whether there is anyone to send to', () => {
    expect(hasRecipient({ ...emptyDraft })).toBe(false)
    expect(hasRecipient({ ...emptyDraft, to: ' ', cc: 'a@example.net' })).toBe(true)
  })
})

describe('an answer', () => {
  it('goes to the sender, in the thread, with the original quoted', () => {
    const draft = replyDraft(original())
    expect(draft).toMatchObject({
      to: 'Anna <anna@example.net>',
      subject: 'Re: Lunch',
      inReplyTo: '<two@example.net>',
      references: '<one@example.net> <two@example.net>'
    })
    expect(draft.body).toBe('\n\nAm Mon, 19 Oct 2026 10:00:00 +0200 schrieb Anna <anna@example.net>:\n> Shall we?\n> At noon.\n')
  })

  it('goes to where the sender asked answers to go', () => {
    expect(replyDraft(original({ replyTo: 'List <list@example.net>' })).to).toBe('List <list@example.net>')
  })

  it('starts a thread of its own when the original had no id, and quotes a quote one level deeper', () => {
    const draft = replyDraft(original({ messageId: '', references: '', text: '> earlier\nnow' }))
    expect(draft.inReplyTo).toBeUndefined()
    expect(draft.references).toBeUndefined()
    expect(draft.body).toContain('>> earlier\n> now')
  })

  it('does not stack “Re:”', () => {
    expect(replySubject('Re: Lunch')).toBe('Re: Lunch')
    expect(replySubject('RE: Lunch')).toBe('RE: Lunch')
    expect(replySubject('Lunch')).toBe('Re: Lunch')
    expect(replySubject('')).toBe('Re:')
  })
})

describe('the input of sending', () => {
  it('has what was typed, with no attachments and no blind copy', () => {
    const input = toComposeInput('acct', {
      ...emptyDraft,
      to: 'Anna <a@example.net>',
      cc: 'b@example.net',
      subject: 'Hi',
      body: 'Text',
      inReplyTo: '<x@example.net>'
    })
    expect(input).toEqual({
      accountId: 'acct',
      to: [{ name: 'Anna', address: 'a@example.net' }],
      cc: [{ name: '', address: 'b@example.net' }],
      bcc: [],
      subject: 'Hi',
      textBody: 'Text',
      htmlBody: '',
      attachments: [],
      inReplyTo: '<x@example.net>',
      references: undefined
    })
  })
})

describe('attaching files', () => {
  const picked = (name: string, size: number, path = `/store/${name}`): PickedFile => ({
    path,
    name,
    size,
    contentType: 'application/pdf'
  })
  const attached = (name: string, size: number): DraftAttachment => ({
    filename: name,
    path: `/store/${name}`,
    contentType: 'application/pdf',
    size
  })
  function files() {
    const removed: string[] = []
    const access: FileAccess = {
      read: async () => new Uint8Array(0),
      remove: async (paths) => void removed.push(...paths)
    }
    return { access, removed }
  }

  it('adds what was picked to what is attached, in the order picked', async () => {
    const { access, removed } = files()
    const result = await attachPicked([attached('a.pdf', 10)], [picked('b.pdf', 20), picked('c.pdf', 30)], access, 1000)
    expect(result.attachments.map((a) => a.filename)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
    expect(result.refused).toEqual([])
    expect(removed).toEqual([])
  })

  it('does not attach a copy twice, and keeps the copy that is already in use', async () => {
    const { access, removed } = files()
    const result = await attachPicked([attached('a.pdf', 10)], [picked('a.pdf', 10)], access, 1000)
    expect(result.attachments).toHaveLength(1)
    expect(removed).toEqual([])
  })

  it('refuses what would take the message over the limit, says which, and removes the copy it made', async () => {
    const { access, removed } = files()
    const result = await attachPicked([attached('a.pdf', 600)], [picked('big.pdf', 500), picked('small.pdf', 300)], access, 1000)
    expect(result.attachments.map((a) => a.filename)).toEqual(['a.pdf', 'small.pdf'])
    expect(result.refused).toEqual([{ name: 'big.pdf', reason: 'tooLarge' }])
    expect(removed).toEqual(['/store/big.pdf'])
  })

  it('takes a file off a draft and removes its copy', async () => {
    const { access, removed } = files()
    const rest = await detachFile([attached('a.pdf', 1), attached('b.pdf', 2)], '/store/a.pdf', access)
    expect(rest.map((a) => a.filename)).toEqual(['b.pdf'])
    expect(removed).toEqual(['/store/a.pdf'])
  })

  it('goes into the input of sending with its name, path and type, and not its size', () => {
    const input = toComposeInput('acct', { ...emptyDraft, to: 'a@example.net', attachments: [attached('a.pdf', 10)] })
    expect(input.attachments).toEqual([{ filename: 'a.pdf', path: '/store/a.pdf', contentType: 'application/pdf' }])
  })
})

describe('an answer to everybody', () => {
  const everybody = (over: Partial<ReadableMessage> = {}) =>
    original({
      to: 'Alex <alex@example.org>, Bob <bob@example.net>',
      cc: 'Cara <cara@example.net>, alex@example.org',
      ...over
    })

  it('goes to the sender and to the others it was sent to, and the copies stay copies, none of it to oneself', () => {
    const draft = replyAllDraft(everybody(), 'alex@example.org')
    expect(draft.to).toBe('Anna <anna@example.net>, Bob <bob@example.net>')
    expect(draft.cc).toBe('Cara <cara@example.net>')
  })

  it('goes to the Reply-To address instead of the sender, when there is one', () => {
    const draft = replyAllDraft(everybody({ replyTo: 'Lists <list@example.net>' }), 'alex@example.org')
    expect(draft.to).toBe('Lists <list@example.net>, Bob <bob@example.net>')
  })

  it('names nobody twice, whatever case the addresses are written in', () => {
    const draft = replyAllDraft(everybody({ to: 'ANNA@example.net, bob@example.net, Bob <BOB@example.net>', cc: 'bob@EXAMPLE.net' }), 'alex@example.org')
    expect(draft.to).toBe('Anna <anna@example.net>, bob@example.net')
    expect(draft.cc).toBe('')
  })

  it('keeps what an answer has: the subject, the quote and the thread', () => {
    const draft = replyAllDraft(everybody(), 'alex@example.org')
    expect(draft).toMatchObject({ subject: 'Re: Lunch', inReplyTo: '<two@example.net>', references: '<one@example.net> <two@example.net>' })
    expect(draft.body).toContain('> Shall we?')
  })

  it('works without an address of its own to leave out', () => {
    expect(replyAllDraft(everybody(), '').to).toContain('alex@example.org')
  })
})

describe('a message passed on', () => {
  it('has no recipient, a subject that says so once, and the message under a line that says what it is', () => {
    const draft = forwardDraft(original({ to: 'Alex <alex@example.org>' }))
    expect(draft).toMatchObject({ to: '', cc: '', subject: 'Fwd: Lunch', attachments: [] })
    expect(draft.body).toBe(
      '\n\n---------- Weitergeleitete Nachricht ----------\n' +
        'Von: Anna <anna@example.net>\n' +
        'Datum: Mon, 19 Oct 2026 10:00:00 +0200\n' +
        'Betreff: Lunch\n' +
        'An: Alex <alex@example.org>\n\n' +
        'Shall we?\nAt noon.\n'
    )
  })

  it('is not part of the thread it came from', () => {
    const draft = forwardDraft(original())
    expect(draft.inReplyTo).toBeUndefined()
    expect(draft.references).toBeUndefined()
  })

  it('does not put "Fwd:" in front of one that has it, in either of the usual spellings', () => {
    expect(forwardDraft(original({ subject: 'Fwd: Lunch' })).subject).toBe('Fwd: Lunch')
    expect(forwardDraft(original({ subject: 'WG: Lunch' })).subject).toBe('WG: Lunch')
    expect(forwardDraft(original({ subject: 'FW: Lunch' })).subject).toBe('FW: Lunch')
  })

  it('has a subject for a message that had none', () => {
    expect(forwardDraft(original({ subject: '' })).subject).toBe('Fwd:')
  })
})
