import { afterEach, describe, expect, it } from 'vitest'
import { ImapClientSession } from '@peregrine/imap/session'
import { protocolLog } from '../diagnostics/protocolLog'
import { createImapSession, protocolSink } from './createSession'
import { ImapConnection } from './ImapConnection'

const options = {
  host: 'mail.example.com',
  port: 993,
  secure: 'tls' as const,
  username: 'user',
  password: 'secret-password'
}

afterEach(() => {
  protocolLog.setRecording(false)
  protocolLog.setVerbose(false)
  protocolLog.clear()
})

describe('createImapSession', () => {
  it('uses imapflow unless the built-in client was asked for', () => {
    expect(createImapSession(options, false)).toBeInstanceOf(ImapConnection)
  })

  it('uses the built-in client when the setting says so', () => {
    const session = createImapSession(options, true)
    expect(session).toBeInstanceOf(ImapClientSession)
    expect(session).not.toBeInstanceOf(ImapConnection)
  })
})

describe('protocolSink', () => {
  const entries = () => protocolLog.list().map((e) => `${e.source}:${e.text}`)

  it('writes what the client says and hears into the diagnostics log', () => {
    protocolLog.setRecording(true)
    const sink = protocolSink('user@example.com')

    sink({ direction: 'C', text: 'A7 UID STORE 4 +FLAGS.SILENT (\\Seen)' })
    sink({ direction: 'S', text: '* 9 EXISTS' })
    sink({ direction: 'S', text: 'A7 OK Store completed' })

    expect(entries()).toEqual([
      'client:A7 UID STORE 4 +FLAGS.SILENT (\\Seen)',
      'server:* 9 EXISTS',
      'server:A7 OK Store completed'
    ])
  })

  // A sync produces thousands of these and they drown out the command flow. imapflow's go in as
  // bulk, and so do these.
  it('treats the individual FETCH responses as bulk, as imapflow does', () => {
    protocolLog.setRecording(true)
    const sink = protocolSink('user@example.com')
    const fetch = { direction: 'S' as const, text: '* 12 FETCH (UID 12 FLAGS (\\Seen))' }

    sink(fetch)
    expect(entries()).toEqual([])

    protocolLog.setVerbose(true)
    sink(fetch)
    expect(entries()).toEqual([`server:${fetch.text}`])
  })

  it('does not mistake a client command for a FETCH response', () => {
    protocolLog.setRecording(true)
    protocolSink('user@example.com')({ direction: 'C', text: '* 12 FETCH look-alike' })
    expect(entries()).toHaveLength(1)
  })

  // The client masks the secret before the line gets here, and the log redacts on its own account.
  // Neither is trusted to be the only one.
  it('keeps the password out of the log, whichever of the two does the work', () => {
    protocolLog.setRecording(true)
    const sink = protocolSink('user@example.com')

    sink({ direction: 'C', text: 'A1 AUTHENTICATE ***' })
    sink({ direction: 'S', text: 'A1 OK Logged in' })
    // A client that logged the secret anyway.
    sink({ direction: 'C', text: 'A2 LOGIN user secret-password' })
    sink({ direction: 'S', text: 'A2 OK Logged in' })
    sink({ direction: 'C', text: 'A3 AUTHENTICATE PLAIN AHVzZXIAc2VjcmV0LXBhc3N3b3Jk' })
    sink({ direction: 'S', text: '+ ' })
    sink({ direction: 'C', text: 'AHVzZXIAc2VjcmV0LXBhc3N3b3Jk' })
    sink({ direction: 'S', text: 'A3 OK Logged in' })

    const text = JSON.stringify(protocolLog.list())
    expect(text).not.toContain('secret-password')
    expect(text).not.toContain('AHVzZXIAc2VjcmV0LXBhc3N3b3Jk')
  })

  it('records nothing while recording is off', () => {
    protocolSink('user@example.com')({ direction: 'C', text: 'A1 NOOP' })
    expect(entries()).toEqual([])
  })
})
