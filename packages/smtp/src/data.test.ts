import { describe, expect, it } from 'vitest'
import { hasEightBit, prepareData } from './data'

const bytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0))
const text = (data: Uint8Array): string => String.fromCharCode(...data)

describe('prepareData', () => {
  it('ends the message with a line of one dot', () => {
    expect(text(prepareData(bytes('Hello\r\n')))).toBe('Hello\r\n.\r\n')
  })

  it('ends a last line that has no line end before putting the dot on a line of its own', () => {
    expect(text(prepareData(bytes('Hello')))).toBe('Hello\r\n.\r\n')
  })

  it('writes the end of an empty message as the dot alone', () => {
    expect(text(prepareData(bytes('')))).toBe('.\r\n')
  })

  // The dot is how the server knows the message is over. A line of one dot inside it would end it
  // early and let what follows be read as commands.
  it('doubles a dot at the start of a line, and only there', () => {
    expect(text(prepareData(bytes('a\r\n.\r\n..\r\n.x\r\nb.c\r\n')))).toBe('a\r\n..\r\n...\r\n..x\r\nb.c\r\n.\r\n')
  })

  it('doubles a dot at the very start of the message', () => {
    expect(text(prepareData(bytes('.hidden')))).toBe('..hidden\r\n.\r\n')
  })

  // A server that reads a bare line feed as a line end and one that does not disagree about where
  // a line starts. That disagreement is the way into the attack that sends mail in another's name.
  it('writes a bare line feed as CR LF, so that no server has to decide', () => {
    expect(text(prepareData(bytes('a\n.\nb')))).toBe('a\r\n..\r\nb\r\n.\r\n')
  })

  it('writes a bare carriage return as CR LF too', () => {
    expect(text(prepareData(bytes('a\r.\rb')))).toBe('a\r\n..\r\nb\r\n.\r\n')
  })

  it('keeps CR LF as one line end and does not double it', () => {
    expect(text(prepareData(bytes('a\r\nb\r\n')))).toBe('a\r\nb\r\n.\r\n')
  })

  it('does not read a smuggled end of message as an end', () => {
    // LF.CR LF in the middle is a line of one dot to a server that takes a bare LF as a line end.
    expect(text(prepareData(bytes('x\n.\r\nMAIL FROM:<a@b.example>\r\n')))).toBe(
      'x\r\n..\r\nMAIL FROM:<a@b.example>\r\n.\r\n'
    )
  })

  it('takes every other byte as it is, binary ones included', () => {
    const source = Uint8Array.from([0, 255, 128, 65])
    expect([...prepareData(source)]).toEqual([0, 255, 128, 65, 13, 10, 46, 13, 10])
  })

  it('handles a large message in one go', () => {
    const line = `${'x'.repeat(76)}\r\n`
    const source = bytes(line.repeat(20_000))
    const out = prepareData(source)
    expect(out.length).toBe(source.length + 3)
  })
})

describe('hasEightBit', () => {
  it('tells 7-bit text from the rest', () => {
    expect(hasEightBit(bytes('plain text\r\n'))).toBe(false)
    expect(hasEightBit(Uint8Array.from([65, 200]))).toBe(true)
  })
})
