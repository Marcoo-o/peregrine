import { describe, expect, it } from 'vitest'
import { describeError, explainError } from './errors'

describe('describing an error', () => {
  it('is the message of an error, and the text of anything else that was thrown', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
    expect(describeError('plain')).toBe('plain')
    expect(describeError(42)).toBe('42')
  })
})

describe('explaining an error', () => {
  const explained = (message: string) => explainError(new Error(message))

  it('says in German that the connection ended, for every way the libraries put it', () => {
    for (const message of [
      'The connection is closed',
      'The connection was closed',
      'connection closed',
      'Not connected',
      'Connection closed by peer',
      'Broken pipe',
      'The server stopped answering'
    ]) {
      expect(explained(message), message).toMatch(/^Die Verbindung zum Server wurde getrennt\./)
    }
  })

  it('says that the server cannot be reached', () => {
    for (const message of [
      'Failed to connect to imap.example.org/203.0.113.7:993',
      'connect ECONNREFUSED 127.0.0.1:993',
      'Network is unreachable',
      'Unable to resolve host "imap.example.org"'
    ]) {
      expect(explained(message), message).toMatch(/^Der Server ist nicht erreichbar\./)
    }
  })

  it('says that the server does not answer', () => {
    expect(explained('The server did not greet in time')).toMatch(/^Der Server antwortet nicht\./)
    expect(explained('Read timed out')).toMatch(/^Der Server antwortet nicht\./)
  })

  it('says that the encrypted connection could not be made', () => {
    expect(explained('SSLHandshakeException: certificate verify failed')).toMatch(/^Die verschlüsselte Verbindung/)
  })

  it('keeps the original text after it, for whoever has to look it up', () => {
    expect(explained('connection closed')).toBe('Die Verbindung zum Server wurde getrennt. (connection closed)')
  })

  // What a server says is its own word, and a guess at its reason sends somebody to the wrong place.
  it('leaves what is not certain as it was written', () => {
    expect(explained('NO [AUTHENTICATIONFAILED] Invalid credentials')).toBe('NO [AUTHENTICATIONFAILED] Invalid credentials')
    expect(explained('Die Nachricht gibt es auf dem Server nicht mehr')).toBe('Die Nachricht gibt es auf dem Server nicht mehr')
  })

  it('takes a string as well as an error, which is what a queued action keeps', () => {
    expect(explainError('connection closed')).toMatch(/^Die Verbindung zum Server wurde getrennt\./)
  })
})
