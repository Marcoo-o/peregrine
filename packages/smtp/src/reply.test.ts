import { describe, expect, it } from 'vitest'
import { SmtpError } from './errors'
import { ReplyReader } from './reply'

const bytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0))

describe('ReplyReader', () => {
  it('reads a reply of one line', () => {
    expect(new ReplyReader().push(bytes('250 OK\r\n'))).toEqual([{ code: 250, lines: ['OK'] }])
  })

  it('reads a reply of several lines as one', () => {
    const replies = new ReplyReader().push(bytes('250-mail.example\r\n250-SIZE 100\r\n250 8BITMIME\r\n'))
    expect(replies).toEqual([{ code: 250, lines: ['mail.example', 'SIZE 100', '8BITMIME'] }])
  })

  it('reads two replies that arrive together', () => {
    const replies = new ReplyReader().push(bytes('220 Ready\r\n250 OK\r\n'))
    expect(replies.map((reply) => reply.code)).toEqual([220, 250])
  })

  it('waits for the rest of a reply cut in two, in the middle of a word and between its lines', () => {
    const reader = new ReplyReader()
    expect(reader.push(bytes('25'))).toEqual([])
    expect(reader.push(bytes('0-first\r\n250 la'))).toEqual([])
    expect(reader.push(bytes('st\r\n'))).toEqual([{ code: 250, lines: ['first', 'last'] }])
  })

  it('reads a line end that is a bare line feed, which many servers send', () => {
    expect(new ReplyReader().push(bytes('250 OK\n'))).toEqual([{ code: 250, lines: ['OK'] }])
  })

  it('reads a reply that is only a code', () => {
    expect(new ReplyReader().push(bytes('250\r\n'))).toEqual([{ code: 250, lines: [''] }])
    expect(new ReplyReader().push(bytes('250-\r\n250 x\r\n'))).toEqual([{ code: 250, lines: ['', 'x'] }])
  })

  it('keeps every byte, those beyond ASCII included', () => {
    const replies = new ReplyReader().push(Uint8Array.from([50, 53, 48, 32, 0xe4, 13, 10]))
    expect(replies[0].lines[0]).toBe('ä')
  })

  it('refuses what is not a reply, and does not guess', () => {
    for (const bad of ['hello\r\n', '25 OK\r\n', '2500 OK\r\n', '250OK\r\n', ' 250 OK\r\n']) {
      expect(() => new ReplyReader().push(bytes(bad)), bad).toThrow(SmtpError)
    }
  })

  it('refuses a reply that changes its code half way', () => {
    expect(() => new ReplyReader().push(bytes('250-a\r\n354 b\r\n'))).toThrow(/changed its code/)
  })

  it('refuses a line that never ends, and a reply that never does', () => {
    expect(() => new ReplyReader().push(bytes('2'.repeat(5000)))).toThrow(/does not end/)
    const long = Array.from({ length: 300 }, (_, i) => `250-line ${i}\r\n`).join('')
    expect(() => new ReplyReader().push(bytes(long))).toThrow(/too long a reply/)
  })

  it('forgets what it holds when asked to', () => {
    const reader = new ReplyReader()
    reader.push(bytes('250-half\r\n25'))
    reader.reset()
    expect(reader.push(bytes('220 fresh\r\n'))).toEqual([{ code: 220, lines: ['fresh'] }])
  })
})
