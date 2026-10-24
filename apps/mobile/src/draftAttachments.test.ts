import { describe, expect, it } from 'vitest'
import type { AttachmentInfo } from './attachments'
import { bringAttachments, notBroughtText } from './draftAttachments'
import type { PickedFile } from './files'

const EOL = String.fromCharCode(13, 10)

/** A message with the files attached, as source. */
function source(files: Array<{ name: string; text: string }>): Uint8Array {
  const lines = [
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain',
    '',
    'Text',
    ...files.flatMap((file) => [
      '--b',
      `Content-Type: text/plain; name="${file.name}"`,
      `Content-Disposition: attachment; filename="${file.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      btoa(file.text),
      ''
    ]),
    '--b--',
    ''
  ]
  return new TextEncoder().encode(lines.join(EOL))
}

const info = (id: string, filename: string): AttachmentInfo => ({ id, filename, originalName: filename, contentType: 'text/plain', size: 0, findings: [] })

/** The part of the files the helper uses, which keeps what it is given and what it is told to remove. */
function fakeFiles(failAt?: number) {
  const stashed: PickedFile[] = []
  const removed: string[] = []
  return {
    stashed,
    removed,
    files: {
      async stash(name: string, contentType: string, content: Uint8Array): Promise<PickedFile> {
        if (failAt === stashed.length + 1) throw new Error('disk full')
        const file = { path: `/store/${stashed.length + 1}/${name}`, name, size: content.length, contentType }
        stashed.push(file)
        return file
      },
      async read(): Promise<Uint8Array> {
        return new Uint8Array()
      },
      async remove(paths: string[]): Promise<void> {
        removed.push(...paths)
      }
    }
  }
}

describe('bringing the attachments of a message along', () => {
  const two = source([
    { name: 'a.txt', text: 'hello' },
    { name: 'b.txt', text: 'abc' }
  ])

  it('copies each into the storage and attaches the copies, in order', async () => {
    const { files, stashed } = fakeFiles()
    const brought = await bringAttachments(two, [info('2', 'a.txt'), info('3', 'b.txt')], files)
    expect(brought.attachments.map((file) => [file.filename, file.size])).toEqual([['a.txt', 5], ['b.txt', 3]])
    expect(brought.attachments.map((file) => file.path)).toEqual(stashed.map((file) => file.path))
    expect(brought.refused).toEqual([])
    expect(brought.missing).toEqual([])
  })

  it('says which have no content, and goes on with the others', async () => {
    const { files } = fakeFiles()
    const brought = await bringAttachments(two, [info('2', 'a.txt'), info('9', 'gone.bin')], files)
    expect(brought.attachments.map((file) => file.filename)).toEqual(['a.txt'])
    expect(brought.missing).toEqual(['gone.bin'])
  })

  it('has everything missing when there is no source', async () => {
    const { files, stashed } = fakeFiles()
    const brought = await bringAttachments(undefined, [info('2', 'a.txt')], files)
    expect(brought.attachments).toEqual([])
    expect(brought.missing).toEqual(['a.txt'])
    expect(stashed).toEqual([])
  })

  it('refuses what takes the message over the limit, and removes the copy of it', async () => {
    const { files, removed } = fakeFiles()
    const brought = await bringAttachments(two, [info('2', 'a.txt'), info('3', 'b.txt')], files, 6)
    expect(brought.attachments.map((file) => file.filename)).toEqual(['a.txt'])
    expect(brought.refused).toEqual([{ name: 'b.txt', reason: 'tooLarge' }])
    expect(removed).toEqual(['/store/2/b.txt'])
  })

  it('removes the copies made so far when one cannot be copied, and raises why', async () => {
    const { files, removed } = fakeFiles(2)
    await expect(bringAttachments(two, [info('2', 'a.txt'), info('3', 'b.txt')], files)).rejects.toThrow('disk full')
    expect(removed).toEqual(['/store/1/a.txt'])
  })
})

describe('what is said of the attachments that did not go along', () => {
  it('is nothing when all did', () => {
    expect(notBroughtText({ refused: [], missing: [] })).toBeUndefined()
  })

  it('names each, with why', () => {
    expect(notBroughtText({ refused: [{ name: 'big.zip', reason: 'tooLarge' }], missing: ['gone.bin'] })).toBe(
      'Nicht angehängt: big.zip (zu groß für eine Nachricht), gone.bin (nicht lesbar).'
    )
  })
})
