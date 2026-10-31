import { composeMessage } from '@peregrine/smtp/compose'
import { describe, expect, it } from 'vitest'
import { draftFromInput, editableDraft, emptyDraft, isChanged, toComposeInput } from './draft'
import { readMessage } from './messageText'
import { FORMAT_MARK } from './richText'

const written = { ...emptyDraft, to: 'anna@example.net', subject: 'Plan', body: 'Hello **Anna**\n\n- one\n- two', formatted: true }

describe('a draft written with formatting', () => {
  it('goes out as the text as typed and the HTML made from it, which carries the mark', () => {
    const input = toComposeInput('acct', written)
    expect(input.textBody).toBe('Hello **Anna**\n\n- one\n- two')
    expect(input.htmlBody).toContain(FORMAT_MARK)
    expect(input.htmlBody).toContain('<strong>Anna</strong>')
    expect(input.htmlBody).toContain('<li>two</li>')
  })

  it('has no HTML while formatting is off, whatever the text has in it', () => {
    expect(toComposeInput('acct', { ...written, formatted: false }).htmlBody).toBe('')
    expect(toComposeInput('acct', { ...written, formatted: undefined }).htmlBody).toBe('')
  })

  it('is a change to switch formatting on or off', () => {
    expect(isChanged({ ...written, formatted: false }, written)).toBe(true)
    expect(isChanged(written, { ...written })).toBe(false)
  })

  it('is the draft a queued message was made from, formatted again', () => {
    expect(draftFromInput(toComposeInput('acct', written)).formatted).toBe(true)
    expect(draftFromInput(toComposeInput('acct', { ...written, formatted: false })).formatted).toBeUndefined()
  })

  it('goes through a message and back: kept on the server as two parts, and written on again from the text that was typed', () => {
    const input = toComposeInput('acct', written)
    const composed = composeMessage(
      { from: { address: 'alex@example.org' }, to: input.to, cc: [], bcc: [], subject: input.subject, text: input.textBody, html: input.htmlBody, attachments: [] },
      {}
    )
    const source = typeof composed.source === 'string' ? new TextEncoder().encode(composed.source) : composed.source
    expect(new TextDecoder().decode(source)).toContain('multipart/alternative')
    const read = readMessage(source)
    expect(read.text).toContain('Hello **Anna**')
    const again = editableDraft(read)
    expect(again).toMatchObject({ draft: { body: 'Hello **Anna**\n\n- one\n- two', formatted: true } })
  })

  it('is still refused when the formatting is somebody else\'s', () => {
    const read = readMessage(
      new TextEncoder().encode(
        ['From: a@example.net', 'To: b@example.net', 'Subject: x', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', '<p>Not mine</p>'].join('\r\n')
      )
    )
    expect(editableDraft(read)).toMatchObject({ refusal: expect.stringContaining('Formatierung') })
  })
})
