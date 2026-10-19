import { SmtpError } from './errors'

/** Longest address the standard allows. */
const MAX_ADDRESS = 254

/**
 * Whatever must not be in an address that goes into a command: controls, which include the line
 * breaks that would end the command and start another, the angle brackets that hold it, whitespace,
 * the quote and the backslash. The two Unicode line separators and the next-line character are in
 * it as well. They are not line ends to SMTP, but they are to some of the software around it.
 */
const FORBIDDEN = /[\u0000-\u0020\u007f-\u009f\u2028\u2029<>"\\]/

/**
 * Refuses an address that cannot be sent, before any command is.
 *
 * This is the one place where text from outside goes straight into what the server will read as a
 * command: `MAIL FROM:<…>` and `RCPT TO:<…>`. An address that carries a line break and a command
 * after it would make the client say that command. So it is not escaped, which gets this wrong in
 * some corner, but refused. That keeps a few real addresses out: one with a quoted local part that
 * contains a space is not sent. They exist and nobody uses them.
 */
export function checkAddress(address: string, role: string): void {
  if (address === '') throw new SmtpError('invalid', `The ${role} address is empty`)
  if (address.length > MAX_ADDRESS) throw new SmtpError('invalid', `The ${role} address is too long`)
  if (FORBIDDEN.test(address)) {
    throw new SmtpError('invalid', `The ${role} address ${shown(address)} has a character that cannot be in one`)
  }
  const at = address.lastIndexOf('@')
  if (at < 1 || at === address.length - 1) {
    throw new SmtpError('invalid', `The ${role} address ${shown(address)} is not of the form name@domain`)
  }
}

/** True when the address is plain ASCII, so that it needs nothing of the server. */
export function isAscii(address: string): boolean {
  for (let i = 0; i < address.length; i++) if (address.charCodeAt(i) > 127) return false
  return true
}

/** An address as it can go into an error message that a person reads. */
function shown(address: string): string {
  const text = address.slice(0, 60).replace(/[^\x20-\x7e]/g, '?')
  return `"${address.length > 60 ? `${text}…` : text}"`
}
