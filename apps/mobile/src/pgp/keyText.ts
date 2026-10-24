/**
 * A fingerprint as people compare it, in groups of four and in upper case. All of it is long (40 characters) and what is
 * shown on a phone is its end: the last 16 characters are what programs call the key id, and they are enough to tell the
 * keys of one person apart. Whoever has to be sure compares all of it, which the export of the key allows.
 */
export function shortFingerprint(fingerprint: string): string {
  return (
    fingerprint
      .slice(-16)
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.join(' ') ?? ''
  )
}

/** The whole fingerprint in groups of four, for comparing it with what the owner of the key says it is. */
export function groupedFingerprint(fingerprint: string): string {
  return fingerprint.toUpperCase().match(/.{1,4}/g)?.join(' ') ?? ''
}

/** The name of the file a public key is saved under: the address it is for, with nothing in it that a file name cannot hold. */
export function keyFileName(address: string): string {
  const name = address.replace(/[^A-Za-z0-9@._+-]/g, '_')
  return `${name === '' ? 'schluessel' : name}.asc`
}
