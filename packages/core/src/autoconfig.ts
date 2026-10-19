import type { SecureMode } from './types'

/**
 * Mozilla's autoconfig format, as served by autoconfig.thunderbird.net and by providers
 * themselves.
 *
 * Parsed by hand rather than with an XML library. The format is a handful of fixed elements
 * with no attributes worth speaking of, no namespaces and no mixed content; a general parser
 * would be a dependency in the main process, one that has to be kept up to date, for a
 * document one can read with a scanner in fifty lines. The scanner is deliberately strict:
 * anything it does not recognise becomes "not found", and the caller falls back to the next
 * source instead of building a half-configured account.
 */

export interface DiscoveredServer {
  host: string
  port: number
  secure: SecureMode
  /** Already resolved for the address that was asked about. */
  username: string
  /** Only 'password' can be set up here; 'oauth2' has to be reported, not swallowed. */
  authType: 'password' | 'oauth2'
}

export interface DiscoveredConfig {
  displayName: string
  imap: DiscoveredServer
  smtp: DiscoveredServer
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'"
}

function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (match) => ENTITIES[match] ?? match)
}

/** The text of the first `<tag>` inside `scope`; undefined when it is not there. */
function tagText(scope: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(scope)
  return match ? decode(match[1].trim()) : undefined
}

/** Every `<tag …>…</tag>` block, so the imap one can be picked out of several servers. */
function tagBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = []
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) blocks.push(match[0])
  return blocks
}

function typeAttribute(block: string): string {
  return /\btype\s*=\s*"([^"]*)"/i.exec(block)?.[1].toLowerCase() ?? ''
}

/**
 * `plain` | `SSL` | `STARTTLS` in the file, three different words for it in the wild.
 *
 * An unknown value returns null rather than a guess: getting this wrong means either a
 * connection that will not come up, or worse, one that goes out unencrypted.
 */
export function parseSocketType(value: string | undefined): SecureMode | null {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'ssl':
      return 'tls'
    case 'starttls':
      return 'starttls'
    case 'plain':
      return 'none'
    default:
      return null
  }
}

/** `%EMAILADDRESS%`, `%EMAILLOCALPART%` and `%EMAILDOMAIN%` are the placeholders in use. */
export function resolveUsername(template: string | undefined, email: string): string {
  const [localPart = '', domain = ''] = email.split('@')
  return (template ?? '%EMAILADDRESS%')
    .replace(/%EMAILADDRESS%/gi, email)
    .replace(/%EMAILLOCALPART%/gi, localPart)
    .replace(/%EMAILDOMAIN%/gi, domain)
}

function parseServer(block: string, email: string): DiscoveredServer | null {
  const host = tagText(block, 'hostname')
  const port = Number(tagText(block, 'port'))
  const secure = parseSocketType(tagText(block, 'socketType'))
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535 || secure === null) return null

  const authentication = (tagText(block, 'authentication') ?? '').toLowerCase()
  return {
    host,
    port,
    secure,
    username: resolveUsername(tagText(block, 'username'), email),
    // Everything that is not an OAuth flow is a password from our side. The file
    // distinguishes cleartext from encrypted, which is the server's business, not ours.
    authType: authentication.includes('oauth') ? 'oauth2' : 'password'
  }
}

/**
 * Reads a clientConfig document.
 *
 * Returns null unless both servers are complete: a configuration with an inbox but no way to
 * send is not something to hand to the user as a finished setup.
 */
export function parseAutoconfig(xml: string, email: string): DiscoveredConfig | null {
  if (!/<clientConfig\b/i.test(xml)) return null

  // A provider may list POP3 first, or several SMTP servers; the imap one is the only one
  // this application can use.
  const imapBlock = tagBlocks(xml, 'incomingServer').find((b) => typeAttribute(b) === 'imap')
  const smtpBlock = tagBlocks(xml, 'outgoingServer').find((b) => typeAttribute(b) === 'smtp')
  if (!imapBlock || !smtpBlock) return null

  const imap = parseServer(imapBlock, email)
  const smtp = parseServer(smtpBlock, email)
  if (!imap || !smtp) return null

  return {
    displayName: tagText(xml, 'displayName') ?? tagText(xml, 'domain') ?? '',
    imap,
    smtp
  }
}
