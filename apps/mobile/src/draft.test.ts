import { describe, expect, it } from 'vitest'
import { hasRecipient, parseAddressList, replyDraft, replySubject, splitAddressList, toComposeInput } from './draft'
import type { ReadableMessage } from './messageText'

const original = (over: Partial<ReadableMessage> = {}): ReadableMessage => ({
  subject: 'Lunch',
  from: 'Anna <anna@example.net>',
  date: 'Mon, 19 Oct 2026 10:00:00 +0200',
  text: 'Shall we?\r\nAt noon.\r\n',
  messageId: '<two@example.net>',
  references: '<one@example.net>',
  replyTo: '',
  ...over
})

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
    expect(hasRecipient({ to: '', cc: '', subject: '', body: '' })).toBe(false)
    expect(hasRecipient({ to: ' ', cc: 'a@example.net', subject: '', body: '' })).toBe(true)
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
    const input = toComposeInput('acct', { to: 'Anna <a@example.net>', cc: 'b@example.net', subject: 'Hi', body: 'Text', inReplyTo: '<x@example.net>' })
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
