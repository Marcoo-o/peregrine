/**
 * The media types of the files people attach, by extension and back. Not a registry: the few that
 * come up, and `application/octet-stream` for the rest, which every client takes as "a file".
 */
const TYPES: [string, string][] = [
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['bmp', 'image/bmp'],
  ['txt', 'text/plain'],
  ['csv', 'text/csv'],
  ['html', 'text/html'],
  ['htm', 'text/html'],
  ['ics', 'text/calendar'],
  ['json', 'application/json'],
  ['xml', 'application/xml'],
  ['zip', 'application/zip'],
  ['gz', 'application/gzip'],
  ['rtf', 'application/rtf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['ppt', 'application/vnd.ms-powerpoint'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['odt', 'application/vnd.oasis.opendocument.text'],
  ['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['mp3', 'audio/mpeg'],
  ['mp4', 'video/mp4'],
  ['eml', 'message/rfc822']
]

export const OCTET_STREAM = 'application/octet-stream'

const BY_EXTENSION = new Map(TYPES)
// The first extension listed for a type is the one it gets: jpg and not jpeg.
const BY_TYPE = new Map<string, string>()
for (const [extension, type] of TYPES) if (!BY_TYPE.has(type)) BY_TYPE.set(type, extension)

/** The type a file name leads to, or `application/octet-stream`. */
export function contentTypeFor(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 1) return OCTET_STREAM
  return BY_EXTENSION.get(filename.slice(dot + 1).toLowerCase()) ?? OCTET_STREAM
}

/** The extension, with its dot, that goes with a type, or an empty string. */
export function extensionFor(contentType: string): string {
  const extension = BY_TYPE.get(contentType.toLowerCase())
  return extension ? `.${extension}` : ''
}
