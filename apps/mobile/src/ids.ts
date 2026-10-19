/**
 * An id for a row that is made on the phone: the time in base 36 and ten random characters, which
 * is unique for any one user and not meant to be secret. Hermes has no `crypto.randomUUID` to count
 * on, and nothing here is protected by an id being hard to guess.
 */
export function newId(random: () => number = Math.random, now: () => number = Date.now): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let i = 0; i < 10; i++) suffix += alphabet[Math.floor(random() * alphabet.length) % alphabet.length]
  return `${now().toString(36)}${suffix}`
}
