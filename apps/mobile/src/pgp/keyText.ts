/**
 * A fingerprint as people compare it: in groups of four, in upper case, in two lines of five groups. It is 40 characters
 * long, and what is read out or checked against what the owner of the key says is all of it.
 */
export function fingerprintLines(fingerprint: string): string {
  const groups = fingerprint.toUpperCase().match(/.{1,4}/g) ?? []
  return [groups.slice(0, 5).join(' '), groups.slice(5).join(' ')].filter((line) => line !== '').join('\n')
}

/**
 * The name a public key is saved under: the address it is for, with nothing in it that a file name cannot hold. It has no
 * extension of its own: the system adds the one that goes with the kind of file, which is the one programs look for.
 */
export function keyFileName(address: string): string {
  const name = address.replace(/[^A-Za-z0-9@._+-]/g, '_')
  return name === '' ? 'schluessel' : name
}
