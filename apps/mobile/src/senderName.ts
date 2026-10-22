import { parseAddress } from '@peregrine/smtp/headers'

/** Who wrote a message, as a name when the sender gave one and as the address when not. */
export function senderName(sender: string): string {
  const { name, address } = parseAddress(sender)
  return name || address
}
