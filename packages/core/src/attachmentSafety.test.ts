import { describe, expect, it } from 'vitest'
import { analyzeAttachmentName, isExecutableName, refusalForOpening, type AttachmentRisk } from './attachmentSafety'

const risks = (filename: string): AttachmentRisk[] =>
  analyzeAttachmentName(filename).map((f) => f.risk)

describe('analyzeAttachmentName', () => {
  it('says nothing about an ordinary document', () => {
    expect(risks('Rechnung März 2026.pdf')).toEqual([])
  })

  it('reports a program', () => {
    expect(risks('setup.exe')).toEqual(['executable'])
  })

  it('reports a script as a program too', () => {
    expect(risks('rechnung.js')).toContain('executable')
    expect(risks('update.ps1')).toContain('executable')
  })

  it('reports the classic double extension', () => {
    expect(risks('Rechnung.pdf.exe')).toEqual(['executable', 'doubleExtension'])
  })

  it('does not treat a version number as a second extension', () => {
    expect(risks('bericht.v2.pdf')).toEqual([])
  })

  it('reports an archive, because nothing can see inside it', () => {
    expect(risks('unterlagen.zip')).toEqual(['archive'])
  })

  it('reports a name using direction override to disguise the extension', () => {
    expect(risks('rechnung‮fdp.exe')).toContain('deceptiveName')
  })

  it('is not fooled by capitals', () => {
    expect(risks('SETUP.EXE')).toContain('executable')
  })

  it('handles a name with no extension at all', () => {
    expect(risks('README')).toEqual([])
  })

  it('handles an empty name', () => {
    expect(risks('')).toEqual([])
  })
})

/**
 * These are the names that reached `shell.openPath` before the main process asked about the
 * extension. None of them carries a signature, so the check on the first bytes answered
 * "unknown" and let every one of them through.
 */
describe('isExecutableName', () => {
  it.each([
    'rechnung.bat',
    'rechnung.cmd',
    'rechnung.js',
    'rechnung.vbs',
    'rechnung.hta',
    'rechnung.ps1',
    'rechnung.reg',
    'rechnung.wsf',
    'rechnung.lnk',
    // These two carried no warning at all, because they were in no list.
    'rechnung.url',
    'rechnung.desktop'
  ])('refuses %s', (name) => {
    expect(isExecutableName(name)).toBe(true)
  })

  it.each(['Rechnung.pdf', 'Angebot.docx', 'Bild.jpeg', 'Notizen.txt', 'README'])(
    'lets %s through',
    (name) => {
      expect(isExecutableName(name)).toBe(false)
    }
  )

  it('goes by the last extension, which is the one the shell uses', () => {
    expect(isExecutableName('Rechnung.pdf.bat')).toBe(true)
    expect(isExecutableName('Sicherung.bat.txt')).toBe(false)
  })

  it('is not fooled by capitals', () => {
    expect(isExecutableName('RECHNUNG.URL')).toBe(true)
  })

  it('warns about the same names it refuses', () => {
    for (const name of ['rechnung.url', 'rechnung.desktop', 'rechnung.bat']) {
      expect(risks(name)).toContain('executable')
    }
  })
})

describe('refusalForOpening', () => {
  const bytesOf = (...values: number[]): Uint8Array => Uint8Array.from(values)
  const text = (value: string): Uint8Array => Uint8Array.from(value, (c) => c.charCodeAt(0))
  const windowsProgram = bytesOf(0x4d, 0x5a, 0x90, 0x00, 0x03)
  const pdf = text('%PDF-1.7\n')

  it('lets an honest document be opened', () => {
    expect(refusalForOpening('Rechnung.pdf', pdf)).toBeNull()
  })

  it('lets a text file be opened, which has no signature to contradict', () => {
    expect(refusalForOpening('notes.txt', text('Hello'))).toBeNull()
    expect(refusalForOpening('data.csv', text('a,b\n1,2'))).toBeNull()
  })

  // A script is plain text, so only its name gives it away.
  it('refuses a script by its name alone', () => {
    expect(refusalForOpening('update.bat', text('echo hi'))).toBe('executable')
    expect(refusalForOpening('link.url', new Uint8Array(0))).toBe('executable')
  })

  it('refuses a program that is named as something else', () => {
    expect(refusalForOpening('invoice.pdf', windowsProgram)).toBe('executable')
  })

  it('refuses a file whose content contradicts its name, without calling it a program', () => {
    expect(refusalForOpening('photo.png', pdf)).toBe('mismatch')
  })

  it('is quiet about an extension nothing is known of', () => {
    expect(refusalForOpening('thing.xyz', pdf)).toBeNull()
  })
})
