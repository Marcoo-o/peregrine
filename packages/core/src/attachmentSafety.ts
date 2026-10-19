import { invisibleCharactersIn } from './linkSafety'

/**
 * Judges an attachment by its name alone.
 *
 * Deliberately not a virus check and not a guess at content. Just the two things a file name
 * can genuinely give away: that opening it would run a program, and that the name is built to
 * hide which kind of file it is.
 */

export type AttachmentRisk =
  /** Opening it hands the file to something that executes it. */
  | 'executable'
  /** Two extensions, the last one being the one that counts. */
  | 'doubleExtension'
  /** Direction-changing or invisible characters that make the name read differently. */
  | 'deceptiveName'
  /** Archives hide their contents from every check until they are unpacked. */
  | 'archive'

export interface AttachmentFinding {
  risk: AttachmentRisk
  detail: string
}

/**
 * Extensions where opening the file *is* running it.
 *
 * Not "dangerous file types" in general: a PDF can carry an exploit too. These are the ones
 * where the shell hands the file to something that executes it, so the warning states
 * something certain rather than a suspicion.
 *
 * The extension is what decides this, not the content. A script is plain text and carries no
 * signature to recognise it by, and the shell does not look at the bytes either: it looks the
 * extension up and starts whatever is registered for it. Judging these by content therefore
 * cannot work, and a check that only knew about compiled programs would pass every one of
 * them through.
 *
 * `url`, `website` and `desktop` are here although they run nothing themselves. They name a
 * target the reader cannot see, and following it can mean a UNC path that hands an
 * authentication attempt to a stranger's server.
 */
const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'msc', 'jar',
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta',
  'reg', 'lnk', 'inf', 'scf', 'application', 'gadget', 'iso', 'img', 'vhd', 'vhdx',
  'ws', 'wsc', 'sct', 'msh', 'mshxml', 'chm', 'hlp', 'jnlp', 'appref-ms',
  'url', 'website', 'desktop', 'command', 'app', 'pkg'
])

/**
 * Whether opening this name would start something rather than show something.
 *
 * Used by the main process to refuse outright, which is why it is a plain answer rather than a
 * finding: at that point there is nobody left to warn.
 */
export function isExecutableName(filename: string): boolean {
  const parts = extensions(filename)
  return EXECUTABLE_EXTENSIONS.has(parts[parts.length - 1] ?? '')
}

/** Extensions that look harmless and are therefore used as the visible half of a double one. */
const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'csv', 'xml', 'html', 'htm'
])

const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'cab', 'ace'])

function extensions(filename: string): string[] {
  return filename.toLowerCase().split('.').slice(1)
}

export function analyzeAttachmentName(filename: string): AttachmentFinding[] {
  const findings: AttachmentFinding[] = []
  if (!filename) return findings

  const parts = extensions(filename)
  const last = parts[parts.length - 1] ?? ''

  if (EXECUTABLE_EXTENSIONS.has(last)) {
    findings.push({ risk: 'executable', detail: `.${last}` })
  } else if (ARCHIVE_EXTENSIONS.has(last)) {
    findings.push({ risk: 'archive', detail: `.${last}` })
  }

  // "rechnung.pdf.exe" shows as a PDF in any list that truncates, and runs as a program.
  if (parts.length >= 2) {
    const secondToLast = parts[parts.length - 2]
    if (DOCUMENT_EXTENSIONS.has(secondToLast) && last !== secondToLast) {
      findings.push({ risk: 'doubleExtension', detail: `.${secondToLast}.${last}` })
    }
  }

  const invisible = invisibleCharactersIn(filename)
  if (invisible.length > 0) {
    findings.push({ risk: 'deceptiveName', detail: invisible.join(', ') })
  }

  return findings
}
