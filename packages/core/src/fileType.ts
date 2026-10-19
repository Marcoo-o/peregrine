/**
 * Recognises what a file actually is from its first bytes, and says when that disagrees with
 * what its name claims.
 *
 * Until now an attachment was judged by its name alone. That reads the label rather than the
 * contents, and the label is written by the sender. A file called `invoice.pdf` whose bytes
 * begin with `MZ` is a Windows program, and nothing in the interface said so.
 *
 * This is not a virus check and does not pretend to be one. It answers two narrow questions
 * that the bytes can answer with certainty: is this an executable, and does the name lie about
 * the type. Both are worth stating plainly, because both are the shape a delivered program
 * actually takes.
 */

export type SniffedType =
  | 'pdf'
  | 'zip'
  | 'rar'
  | 'sevenZip'
  | 'gzip'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'rtf'
  | 'msOffice'
  | 'windowsExecutable'
  | 'linuxExecutable'
  | 'macExecutable'
  | 'shellScript'
  | 'windowsShortcut'
  | 'classDex'
  | 'unknown'

/** A signature at a known offset. The order below matters where two prefixes overlap. */
interface Signature {
  type: SniffedType
  offset: number
  bytes: number[]
}

/** `.length` of the longest signature plus its offset, so callers know how much to read. */
export const SNIFF_BYTES = 64

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))

const SIGNATURES: Signature[] = [
  // Executables first. Being sure about these matters more than anything else here.
  { type: 'windowsExecutable', offset: 0, bytes: ascii('MZ') },
  { type: 'linuxExecutable', offset: 0, bytes: [0x7f, ...ascii('ELF')] },
  { type: 'macExecutable', offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { type: 'macExecutable', offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { type: 'macExecutable', offset: 0, bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { type: 'macExecutable', offset: 0, bytes: [0xca, 0xfe, 0xba, 0xbe] },
  { type: 'classDex', offset: 0, bytes: ascii('dex\n') },
  { type: 'shellScript', offset: 0, bytes: ascii('#!') },
  // A Windows shortcut runs whatever it points at, so it belongs with the programs.
  { type: 'windowsShortcut', offset: 0, bytes: [0x4c, 0x00, 0x00, 0x00] },

  { type: 'pdf', offset: 0, bytes: ascii('%PDF-') },
  { type: 'rtf', offset: 0, bytes: ascii('{\\rtf') },
  { type: 'png', offset: 0, bytes: [0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: 'gif', offset: 0, bytes: ascii('GIF8') },
  { type: 'bmp', offset: 0, bytes: ascii('BM') },
  { type: 'webp', offset: 8, bytes: ascii('WEBP') },
  { type: 'rar', offset: 0, bytes: [...ascii('Rar!'), 0x1a, 0x07] },
  { type: 'sevenZip', offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { type: 'gzip', offset: 0, bytes: [0x1f, 0x8b] },
  // Legacy Office and MSI share this container. Both can carry macros.
  { type: 'msOffice', offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  // Last, because docx, xlsx, pptx, jar and apk are all zip files underneath.
  { type: 'zip', offset: 0, bytes: [0x50, 0x4b] }
]

function matches(bytes: Uint8Array, signature: Signature): boolean {
  if (bytes.length < signature.offset + signature.bytes.length) return false
  return signature.bytes.every((byte, index) => bytes[signature.offset + index] === byte)
}

export function sniffType(head: Uint8Array): SniffedType {
  for (const signature of SIGNATURES) {
    if (matches(head, signature)) return signature.type
  }
  return 'unknown'
}

/** Opening one of these hands the file to something that runs it. */
const EXECUTABLE_TYPES = new Set<SniffedType>([
  'windowsExecutable',
  'linuxExecutable',
  'macExecutable',
  'shellScript',
  'windowsShortcut',
  'classDex'
])

export function isExecutableContent(type: SniffedType): boolean {
  return EXECUTABLE_TYPES.has(type)
}

/**
 * What the extension leads a reader to expect.
 *
 * Only the types this module can actually recognise are listed. An extension that is absent
 * means "no expectation", and no expectation can be disappointed, so nothing is reported.
 */
const EXPECTED_BY_EXTENSION: Record<string, SniffedType[]> = {
  pdf: ['pdf'],
  png: ['png'],
  jpg: ['jpeg'],
  jpeg: ['jpeg'],
  gif: ['gif'],
  bmp: ['bmp'],
  webp: ['webp'],
  rtf: ['rtf'],
  zip: ['zip'],
  rar: ['rar'],
  '7z': ['sevenZip'],
  gz: ['gzip'],
  tgz: ['gzip'],
  // The modern Office formats are zip containers, the legacy ones are the OLE compound file.
  docx: ['zip'],
  xlsx: ['zip'],
  pptx: ['zip'],
  odt: ['zip'],
  ods: ['zip'],
  doc: ['msOffice'],
  xls: ['msOffice'],
  ppt: ['msOffice'],
  exe: ['windowsExecutable'],
  dll: ['windowsExecutable'],
  msi: ['msOffice'],
  lnk: ['windowsShortcut']
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/**
 * True when the bytes contradict the name.
 *
 * Deliberately quiet when it cannot tell. `unknown` content covers plain text, CSV, HTML and
 * everything else without a signature, and an unlisted extension covers the rest. Reporting a
 * mismatch there would produce a warning on ordinary mail, and a warning that cries wolf is
 * worse than none.
 */
export function contentContradictsName(filename: string, type: SniffedType): boolean {
  if (type === 'unknown') return false
  const expected = EXPECTED_BY_EXTENSION[extensionOf(filename)]
  if (!expected) return false
  return !expected.includes(type)
}
