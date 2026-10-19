import type { SecureMode } from './types'

/**
 * Reads accounts out of a Thunderbird `prefs.js`.
 *
 * Kept free of file system and Electron so it can be tested against a real excerpt: the whole
 * risk of an importer sits in the mapping, not in reading the file. An account silently
 * imported with the wrong encryption or the wrong port is worse than one not imported at all,
 * because it looks finished and fails later.
 */

export type PrefValue = string | number | boolean

/**
 * Parses the `user_pref("key", value);` lines.
 *
 * The format is a JavaScript call, but only ever with literals, so it does not need
 * evaluating. Which is just as well, because this is a foreign file.
 */
export function parsePrefs(text: string): Map<string, PrefValue> {
  const prefs = new Map<string, PrefValue>()
  const line = /^user_pref\("((?:[^"\\]|\\.)*)",\s*(.*?)\);\s*$/

  for (const raw of text.split(/\r?\n/)) {
    const match = line.exec(raw.trim())
    if (!match) continue
    const key = unescapeJs(match[1])
    const value = match[2].trim()

    if (value === 'true' || value === 'false') {
      prefs.set(key, value === 'true')
    } else if (value.startsWith('"')) {
      prefs.set(key, unescapeJs(value.slice(1, -1)))
    } else if (/^-?\d+$/.test(value)) {
      prefs.set(key, Number(value))
    }
    // Anything else (objects, expressions) has no place in prefs.js and is skipped.
  }
  return prefs
}

function unescapeJs(value: string): string {
  return value.replace(/\\(["\\/])/g, '$1')
}

/**
 * Why an account cannot be taken over as it stands.
 *
 * Reported rather than silently dropped: someone who sees 15 accounts in Thunderbird and 13
 * here needs to know which two are missing and why.
 */
export type ImportBlocker =
  /** Peregrine speaks IMAP only. */
  | 'pop3'
  /** Sign-in via Google/Microsoft, which needs an OAuth2 flow we do not have yet. */
  | 'oauth2'
  /** No outgoing server could be resolved. */
  | 'noSmtp'
  /** Host or address missing. Nothing usable to import. */
  | 'incomplete'

export interface ImportableAccount {
  /** Thunderbird's own key ("account3"), so a selection stays stable across re-reads. */
  key: string
  displayName: string
  emailAddress: string
  imapHost: string
  imapPort: number
  imapSecure: SecureMode
  imapUsername: string
  smtpHost: string
  smtpPort: number
  smtpSecure: SecureMode
  smtpUsername: string
  /**
   * Where this account's mail directory sits inside the profile, as written in
   * `directory-rel`. The filter rules live in there, and the folder name is not derivable
   * from the host: Thunderbird numbers them when several accounts share one server.
   */
  directoryRel: string
  /** Empty when the account can be imported as it is. */
  blockers: ImportBlocker[]
}

/**
 * Thunderbird's socket setting.
 *
 * `1` is a historical "try STARTTLS, carry on unencrypted if it fails" that Thunderbird itself
 * no longer offers. It is mapped to STARTTLS rather than to none: an account set that way does
 * reach a server that supports STARTTLS, and quietly turning encryption off during an import
 * is not a downgrade anyone would notice.
 */
function secureModeFrom(value: PrefValue | undefined): SecureMode {
  switch (value) {
    case 3:
      return 'tls'
    case 2:
    case 1:
      return 'starttls'
    case 0:
      return 'none'
    default:
      // Absent means Thunderbird's default, which is SSL/TLS for the ports it suggests.
      return 'tls'
  }
}

/** Thunderbird's authMethod 10 is OAuth2; everything else is some form of password. */
const AUTH_OAUTH2 = 10

function str(prefs: Map<string, PrefValue>, key: string): string {
  const value = prefs.get(key)
  return typeof value === 'string' ? value : ''
}

function num(prefs: Map<string, PrefValue>, key: string, fallback: number): number {
  const value = prefs.get(key)
  return typeof value === 'number' ? value : fallback
}

/** Default ports, used when Thunderbird stored none because it was using its own default. */
const DEFAULT_IMAP_PORT: Record<SecureMode, number> = { tls: 993, starttls: 143, none: 143 }
const DEFAULT_SMTP_PORT: Record<SecureMode, number> = { tls: 465, starttls: 587, none: 25 }

export function parseThunderbirdAccounts(prefsText: string): ImportableAccount[] {
  const prefs = parsePrefs(prefsText)

  const accountKeys = str(prefs, 'mail.accountmanager.accounts')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)

  const defaultSmtp = str(prefs, 'mail.smtp.defaultserver')
  const accounts: ImportableAccount[] = []

  for (const key of accountKeys) {
    const server = str(prefs, `mail.account.${key}.server`)
    if (!server) continue

    const type = str(prefs, `mail.server.${server}.type`)
    // "none" is the Local Folders pseudo-account. Not a mailbox, nothing to import, and not
    // worth reporting as a failure either.
    if (type === 'none' || type === 'rss' || type === '') continue

    const identity = str(prefs, `mail.account.${key}.identities`).split(',')[0]?.trim() ?? ''
    const smtp = str(prefs, `mail.identity.${identity}.smtpServer`) || defaultSmtp

    const imapSecure = secureModeFrom(prefs.get(`mail.server.${server}.socketType`))
    const smtpSecure = secureModeFrom(prefs.get(`mail.smtpserver.${smtp}.try_ssl`))

    const emailAddress = str(prefs, `mail.identity.${identity}.useremail`)
    const imapHost = str(prefs, `mail.server.${server}.hostname`)
    const imapUsername = str(prefs, `mail.server.${server}.userName`) || emailAddress

    const blockers: ImportBlocker[] = []
    if (type === 'pop3') blockers.push('pop3')
    if (
      prefs.get(`mail.server.${server}.authMethod`) === AUTH_OAUTH2 ||
      prefs.get(`mail.smtpserver.${smtp}.authMethod`) === AUTH_OAUTH2
    ) {
      blockers.push('oauth2')
    }
    if (!smtp || !str(prefs, `mail.smtpserver.${smtp}.hostname`)) blockers.push('noSmtp')
    if (!imapHost || !emailAddress) blockers.push('incomplete')

    accounts.push({
      key,
      displayName:
        str(prefs, `mail.identity.${identity}.fullName`) ||
        str(prefs, `mail.server.${server}.name`) ||
        emailAddress,
      emailAddress,
      imapHost,
      imapPort: num(prefs, `mail.server.${server}.port`, DEFAULT_IMAP_PORT[imapSecure]),
      imapSecure,
      imapUsername,
      smtpHost: str(prefs, `mail.smtpserver.${smtp}.hostname`),
      smtpPort: num(prefs, `mail.smtpserver.${smtp}.port`, DEFAULT_SMTP_PORT[smtpSecure]),
      smtpSecure,
      smtpUsername: str(prefs, `mail.smtpserver.${smtp}.username`) || imapUsername,
      // The [ProfD] marker in front stands for the profile folder and is dropped here, so
      // what remains is a path to join onto the profile that was already found.
      directoryRel: str(prefs, `mail.server.${server}.directory-rel`).replace(/^\[ProfD\]/, ''),
      blockers
    })
  }

  return accounts
}
