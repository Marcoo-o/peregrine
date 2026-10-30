/**
 * Where the public key of an address is published, which is what a program asks when it has none: the Web Key Directory of the
 * address's domain (WKD), and the keyserver keys.openpgp.org. These are the addresses, made of the address alone; asking is for
 * the platform to do, since it is the platform that has a way to fetch and a hash.
 */

export const KEYSERVER_BASE = 'https://keys.openpgp.org'

/** z-base-32 alphabet as specified for the hashed local parts of WKD. */
const ZBASE32_ALPHABET = 'ybndrfg8ejkmcpqxot1uwisza345h769'

/** The bytes in z-base-32: five bits to a character, the last character filled with zeros. */
export function zBase32Encode(bytes: Uint8Array): string {
  let bits = 0
  let count = 0
  let out = ''
  for (const byte of bytes) {
    bits = ((bits << 8) | byte) & 0xffff
    count += 8
    while (count >= 5) {
      out += ZBASE32_ALPHABET[(bits >>> (count - 5)) & 31]
      count -= 5
    }
  }
  if (count > 0) out += ZBASE32_ALPHABET[(bits << (5 - count)) & 31]
  return out
}

/** The local part and the domain of an address, the domain in lower case, or null for what is not an address. */
export function splitAddress(address: string): { localPart: string; domain: string } | null {
  const trimmed = address.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return null
  return { localPart: trimmed.slice(0, at), domain: trimmed.slice(at + 1).toLowerCase() }
}

/**
 * The two places a domain may publish the key of an address, the better one first: on the `openpgpkey` subdomain (the advanced
 * method), and on the domain itself (the direct method). The name of the file is the SHA-1 of the local part in lower case in
 * z-base-32, and the local part itself is in the query, as the domain's server may want it. `sha1` is the platform's.
 */
export function wkdUrls(address: string, sha1: (bytes: Uint8Array) => Uint8Array, encodeUtf8: (text: string) => Uint8Array): string[] {
  const parts = splitAddress(address)
  if (!parts) return []
  const hashed = zBase32Encode(sha1(encodeUtf8(parts.localPart.toLowerCase())))
  const local = encodeURIComponent(parts.localPart)
  return [
    `https://openpgpkey.${parts.domain}/.well-known/openpgpkey/${parts.domain}/hu/${hashed}?l=${local}`,
    `https://${parts.domain}/.well-known/openpgpkey/hu/${hashed}?l=${local}`
  ]
}

/** Where keys.openpgp.org gives the key of an address, if its owner has let it be published for that address. */
export function keyserverUrl(address: string): string {
  return `${KEYSERVER_BASE}/vks/v1/by-email/${encodeURIComponent(address.trim())}`
}
