/**
 * How a message names the parts of itself that its HTML shows: an image has a `Content-ID`, and the HTML says
 * `cid:` and that id. The id may be written with percent escapes in the HTML where the header has the plain
 * character, so both are put into one spelling before they are compared.
 */

/** An id as the HTML spells it, with its percent escapes undone. What is not escaped is taken as it is. */
export function decodeCid(id: string): string {
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}

/** The id in a `Content-ID` header, without the angle brackets around it. */
export function contentIdOf(header: string | undefined): string {
  return (header ?? '').replace(/^\s*<|>\s*$/g, '')
}

/** The ids the HTML refers to, in the spelling of `decodeCid`, in lower case: ids are not told apart by case. */
export function referencedCids(html: string): Set<string> {
  return new Set([...html.matchAll(/cid:([^"'\s)<>]+)/gi)].map((match) => decodeCid(match[1]).toLowerCase()))
}
