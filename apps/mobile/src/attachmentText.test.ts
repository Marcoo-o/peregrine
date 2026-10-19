import { describe, expect, it } from 'vitest'
import { analyzeAttachmentName } from '@peregrine/core/attachmentSafety'
import { formatSize, refusalText, riskText } from './attachmentText'

describe('a size', () => {
  it('is in bytes, kilobytes and megabytes, with a decimal comma and no needless zero', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(1023)).toBe('1023 B')
    expect(formatSize(1024)).toBe('1 KB')
    expect(formatSize(1536)).toBe('1,5 KB')
    expect(formatSize(1024 * 1024)).toBe('1 MB')
    expect(formatSize(5 * 1024 * 1024 + 300 * 1024)).toBe('5,3 MB')
  })
})

describe('what is said about a file', () => {
  it('has a sentence for every kind of finding the desktop makes', () => {
    const findings = [
      ...analyzeAttachmentName('invoice.pdf.exe'),
      ...analyzeAttachmentName('files.zip'),
      ...analyzeAttachmentName('report‮fdp.exe')
    ]
    expect(new Set(findings.map((f) => f.risk))).toEqual(new Set(['executable', 'doubleExtension', 'archive', 'deceptiveName']))
    for (const finding of findings) expect(riskText(finding).length).toBeGreaterThan(10)
  })

  it('names the extension that makes a program one', () => {
    expect(riskText({ risk: 'executable', detail: '.exe' })).toContain('.exe')
    expect(riskText({ risk: 'doubleExtension', detail: '.pdf.exe' })).toContain('.pdf.exe')
  })

  it('says that saving is possible when opening is refused', () => {
    expect(refusalText('executable')).toContain('Speichern')
    expect(refusalText('mismatch')).toContain('Speichern')
    expect(refusalText('executable')).not.toBe(refusalText('mismatch'))
  })
})
