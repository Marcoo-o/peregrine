import { describe, expect, it } from 'vitest'
import {
  appError,
  isAppErrorCode,
  parseErrorCode,
  plainErrorMessage,
  unwrapIpcMessage
} from './errorText'

describe('unwrapIpcMessage', () => {
  it('takes off what IPC wrapped around the message', () => {
    expect(
      unwrapIpcMessage("Error invoking remote method 'messages:move': Error: notConnected")
    ).toBe('notConnected')
  })

  // The reason this does not split on ': ' and take the last piece, which is what the one
  // hand-written version of this did: plenty of real messages contain a colon.
  it('keeps a message that has a colon of its own intact', () => {
    expect(
      unwrapIpcMessage("Error invoking remote method 'x': Error: connect ECONNREFUSED 10.0.0.1:993")
    ).toBe('connect ECONNREFUSED 10.0.0.1:993')
  })

  it('leaves a message that was never wrapped alone', () => {
    expect(unwrapIpcMessage('socket hang up')).toBe('socket hang up')
  })

  it('takes off a second layer from an error that crossed twice', () => {
    expect(unwrapIpcMessage('Error: Error: unreadable')).toBe('unreadable')
  })
})

describe('parseErrorCode', () => {
  it('recognises a bare code', () => {
    expect(parseErrorCode(new Error('notConnected'))).toEqual({
      code: 'notConnected',
      detail: null
    })
  })

  it('splits off the detail a code carries', () => {
    expect(parseErrorCode(appError('mailboxOpenFailed', 'INBOX/Archiv'))).toEqual({
      code: 'mailboxOpenFailed',
      detail: 'INBOX/Archiv'
    })
  })

  it('survives the trip through IPC', () => {
    const arrived = new Error(
      "Error invoking remote method 'pgp:import': Error: keyserverRejected:503"
    )
    expect(parseErrorCode(arrived)).toEqual({ code: 'keyserverRejected', detail: '503' })
  })

  // A sentence someone wrote is not a code, and must not be mistaken for one. Otherwise it
  // would be looked up, found missing, and shown as the key itself.
  it('does not read a sentence as a code', () => {
    expect(parseErrorCode(new Error('Could not open mailbox'))).toBeNull()
    expect(parseErrorCode(new Error('socket hang up'))).toBeNull()
  })

  it('reports an unknown identifier as a code, but not as one of ours', () => {
    const parsed = parseErrorCode(new Error('somethingFromALibrary'))
    expect(parsed?.code).toBe('somethingFromALibrary')
    expect(isAppErrorCode(parsed!.code)).toBe(false)
  })
})

describe('plainErrorMessage', () => {
  it('is what an untranslatable failure falls back to', () => {
    expect(plainErrorMessage(new Error("Error invoking remote method 'a': Error: socket hang up")))
      .toBe('socket hang up')
  })

  it('copes with something that is not an Error at all', () => {
    expect(plainErrorMessage('kaputt')).toBe('kaputt')
  })
})
