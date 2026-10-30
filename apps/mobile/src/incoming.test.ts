import { describe, expect, it } from 'vitest'
import { draftFromIncoming, parseMailto, refusedText, type Incoming } from './incoming'
import type { FileAccess, PickedFile } from './files'

const incoming = (over: Partial<Incoming> = {}): Incoming => ({ mailto: null, subject: '', text: '', to: [], cc: [], bcc: [], files: [], unreadable: 0, ...over })

const file = (name: string, size: number): PickedFile => ({ path: `/outgoing/${name}`, name, size, contentType: 'application/pdf' })

/** Files that know what was removed. */
function files() {
  const removed: string[] = []
  const access: FileAccess = {
    read: async () => new Uint8Array(),
    remove: async (paths) => {
      removed.push(...paths)
    }
  }
  return { access, removed }
}

describe('reading a mailto link', () => {
  it('takes the addresses in front of the question mark and the fields after it', () => {
    expect(parseMailto('mailto:sam@example.org,kim@example.net?cc=lee@example.org&bcc=ray@example.org&subject=Hello%20there&body=Line%201%0D%0ALine%202')).toEqual({
      to: ['sam@example.org', 'kim@example.net'],
      cc: ['lee@example.org'],
      bcc: ['ray@example.org'],
      subject: 'Hello there',
      body: 'Line 1\nLine 2'
    })
  })

  it('takes a link that is only an address, and one that is only fields', () => {
    expect(parseMailto('mailto:sam@example.org')).toMatchObject({ to: ['sam@example.org'], subject: '', body: '' })
    expect(parseMailto('mailto:?to=sam@example.org&subject=Hi')).toMatchObject({ to: ['sam@example.org'], subject: 'Hi' })
  })

  it('reads the scheme in any case, and addresses that are written with percent signs', () => {
    expect(parseMailto('MAILTO:sam%40example.org')).toMatchObject({ to: ['sam@example.org'] })
  })

  it('does not read what would name a file or a thread: attach, in-reply-to, and any other field', () => {
    const fields = parseMailto('mailto:sam@example.org?attach=/data/user/0/app/secret&in-reply-to=%3Cx@y%3E&x-custom=1')
    expect(fields).toEqual({ to: ['sam@example.org'], cc: [], bcc: [], subject: '', body: '' })
  })

  it('keeps a percent sign that starts nothing, and a plus as a plus', () => {
    expect(parseMailto('mailto:sam@example.org?subject=100%+more')).toMatchObject({ subject: '100%+more' })
  })

  it('is nothing for what is no such link', () => {
    expect(parseMailto('https://example.org')).toBeNull()
    expect(parseMailto('')).toBeNull()
  })
})

describe('the message that something shared starts', () => {
  it('is made of a link: addresses, subject and body', async () => {
    const { draft, error } = await draftFromIncoming(incoming({ mailto: 'mailto:sam@example.org?subject=Hi&body=Hello' }), files().access)
    expect(draft).toMatchObject({ to: 'sam@example.org', subject: 'Hi', body: 'Hello', attachments: [] })
    expect(error).toBeUndefined()
  })

  it('is made of shared text: the text is the body, and the subject is the one given', async () => {
    const { draft } = await draftFromIncoming(incoming({ subject: '  A page\n title ', text: 'https://example.org/page' }), files().access)
    expect(draft).toMatchObject({ subject: 'A page title', body: 'https://example.org/page', to: '' })
  })

  it('names the people that were given, each once whatever the case, ahead of the ones a link names later', async () => {
    const { draft } = await draftFromIncoming(
      incoming({ mailto: 'mailto:sam@example.org', to: ['SAM@example.org', 'kim@example.net'], cc: ['lee@example.org'] }),
      files().access
    )
    expect(draft).toMatchObject({ to: 'sam@example.org, kim@example.net', cc: 'lee@example.org' })
  })

  it('puts shared text under the body of a link', async () => {
    const { draft } = await draftFromIncoming(incoming({ mailto: 'mailto:?body=From%20the%20link', text: 'Shared' }), files().access)
    expect(draft.body).toBe('From the link\n\nShared')
  })

  it('attaches the files that were shared, and says which were too large and removes their copies', async () => {
    const t = files()
    const { draft, error } = await draftFromIncoming(
      incoming({ files: [file('a.pdf', 1000), file('huge.pdf', 30 * 1024 * 1024)] }),
      t.access
    )
    expect(draft.attachments.map((attached) => attached.filename)).toEqual(['a.pdf'])
    expect(error).toBe('Die Datei huge.pdf ist zu groß für eine Nachricht und wurde nicht angehängt.')
    expect(t.removed).toEqual(['/outgoing/huge.pdf'])
  })

  it('does not hold more text than a screen can', async () => {
    const { draft } = await draftFromIncoming(incoming({ text: 'x'.repeat(500_000) }), files().access)
    expect(draft.body).toHaveLength(200_000)
  })
})

describe('files that could not be read', () => {
  it('are said, one or several, together with the ones that were too large', async () => {
    expect((await draftFromIncoming(incoming({ unreadable: 1 }), files().access)).error).toBe('Eine Datei konnte nicht gelesen werden und fehlt.')
    expect((await draftFromIncoming(incoming({ unreadable: 3 }), files().access)).error).toBe('3 Dateien konnten nicht gelesen werden und fehlen.')
    const both = await draftFromIncoming(incoming({ unreadable: 1, files: [file('huge.pdf', 30 * 1024 * 1024)] }), files().access)
    expect(both.error).toBe('Die Datei huge.pdf ist zu groß für eine Nachricht und wurde nicht angehängt. Eine Datei konnte nicht gelesen werden und fehlt.')
  })
})

describe('the line for what was refused', () => {
  it('says nothing when nothing was, and names the files when some were', () => {
    expect(refusedText([])).toBeUndefined()
    expect(refusedText([{ name: 'a', reason: 'tooLarge' }, { name: 'b', reason: 'tooLarge' }])).toBe(
      'Diese Dateien sind zu groß für eine Nachricht und wurden nicht angehängt: a, b.'
    )
  })
})
