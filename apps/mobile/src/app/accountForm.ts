import type { SecureMode } from '@peregrine/core/types'
import type { Account, AccountPatch, NewAccount } from '../accounts'
import type { FoundServers } from '../discovery'
import { smtpSettingsOf } from '../send'

/** The kinds of connection the form offers. An account that was stored may have been made another way. */
export type FormSecurity = 'tls' | 'starttls'

/** What the form for a new account asks for: the way into one mailbox, and out of it. */
export interface AccountForm {
  email: string
  host: string
  port: number
  secure: FormSecurity
  username: string
  password: string
  smtpHost: string
  smtpPort: number
  smtpSecure: FormSecurity
}

/** What it takes to log in to a mailbox. */
export interface ImapLogin {
  host: string
  port: number
  secure: SecureMode
  username: string
  password: string
}

export function imapLoginOf(account: Account): ImapLogin {
  return {
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    username: account.imapUsername,
    password: account.password
  }
}

/** The account that is kept once the form has connected: its name is its address, or its user name. */
export function newAccountFrom(form: AccountForm): NewAccount {
  const email = form.email.trim() || (form.username.includes('@') ? form.username : '')
  const smtpHost = form.smtpHost.trim()
  const sends = smtpHost !== ''
  return {
    displayName: email || form.username,
    emailAddress: email,
    imapHost: form.host,
    imapPort: form.port,
    imapSecure: form.secure,
    imapUsername: form.username,
    smtpHost: sends ? smtpHost : null,
    smtpPort: sends ? form.smtpPort : null,
    smtpSecure: sends ? form.smtpSecure : null,
    smtpUsername: null,
    password: form.password,
    smtpPassword: null
  }
}

/** The form as it is typed: the ports are text until they are submitted. */
export interface FormFields {
  email: string
  host: string
  port: string
  secure: FormSecurity
  username: string
  password: string
  smtpHost: string
  smtpPort: string
  smtpSecure: FormSecurity
}

/** The ports that go with a kind of connection. */
const IMAP_PORTS: Record<FormSecurity, string> = { tls: '993', starttls: '143' }
const SMTP_PORTS: Record<FormSecurity, string> = { tls: '465', starttls: '587' }

/** The fields of an empty form, or of the one that was submitted last, so that nobody types it all again. */
export function initialFields(previous?: AccountForm): FormFields {
  return {
    email: previous?.email ?? '',
    host: previous?.host ?? '',
    port: String(previous?.port ?? IMAP_PORTS.tls),
    secure: previous?.secure ?? 'tls',
    username: previous?.username ?? '',
    password: previous?.password ?? '',
    smtpHost: previous?.smtpHost ?? '',
    smtpPort: String(previous?.smtpPort ?? SMTP_PORTS.starttls),
    smtpSecure: previous?.smtpSecure ?? 'starttls'
  }
}

/** Chooses the kind of connection for reading, and with it the port that is usual for it. */
export function withImapSecurity<T extends FormFields>(fields: T, secure: FormSecurity): T {
  return { ...fields, secure, port: IMAP_PORTS[secure] }
}

/** The same for sending. */
export function withSmtpSecurity<T extends FormFields>(fields: T, smtpSecure: FormSecurity): T {
  return { ...fields, smtpSecure, smtpPort: SMTP_PORTS[smtpSecure] }
}

/**
 * Whether the form can be submitted: a server, a login and a port for reading, and a port for sending
 * if there is a server for it. A form with no server for sending is an account that only reads.
 */
export function isSubmittable(fields: FormFields): boolean {
  const reads = fields.host.trim() !== '' && fields.username !== '' && fields.password !== '' && Number(fields.port) > 0
  const sendsOrNot = fields.smtpHost.trim() === '' || Number(fields.smtpPort) > 0
  return reads && sendsOrNot
}

export function toAccountForm(fields: FormFields): AccountForm {
  return {
    email: fields.email,
    host: fields.host.trim(),
    port: Number(fields.port),
    secure: fields.secure,
    username: fields.username,
    password: fields.password,
    smtpHost: fields.smtpHost,
    smtpPort: Number(fields.smtpPort),
    smtpSecure: fields.smtpSecure
  }
}

/** The form with the servers that were found for the address put in: the ports and kinds of connection as the provider says them, and the login. */
export function withFound(fields: FormFields, found: FoundServers): FormFields {
  return {
    ...fields,
    host: found.imap.host,
    port: String(found.imap.port),
    secure: found.imap.secure === 'starttls' ? 'starttls' : 'tls',
    username: found.imap.username,
    smtpHost: found.smtp.host,
    smtpPort: String(found.smtp.port),
    smtpSecure: found.smtp.secure === 'tls' ? 'tls' : 'starttls'
  }
}

/** Whether what was typed looks like an address that servers can be looked up for: something, an @, and a domain with a dot in it. */
export function looksLikeAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email.trim())
}

/**
 * What the form for changing an account holds: the form for a new one, filled from the account, and what a new one has not: the name, the colour,
 * and a login for sending of its own. The passwords are empty and mean "as they are": the one that is stored is not put into a field.
 */
export interface EditFields extends FormFields {
  displayName: string
  color: string
  smtpUsername: string
  smtpPassword: string
}

export function editFieldsOf(account: Account): EditFields {
  return {
    email: account.emailAddress,
    host: account.imapHost,
    port: String(account.imapPort),
    secure: account.imapSecure === 'starttls' ? 'starttls' : 'tls',
    username: account.imapUsername,
    password: '',
    smtpHost: account.smtpHost ?? '',
    smtpPort: String(account.smtpPort ?? SMTP_PORTS.starttls),
    smtpSecure: account.smtpSecure === 'tls' ? 'tls' : 'starttls',
    displayName: account.displayName,
    color: account.color,
    smtpUsername: account.smtpUsername ?? '',
    smtpPassword: ''
  }
}

/** Whether the form can be submitted: a server, a login and a port for reading, and a port for sending if there is a server for it. The passwords may be empty. */
export function isEditSubmittable(fields: EditFields): boolean {
  const reads = fields.host.trim() !== '' && fields.username.trim() !== '' && Number(fields.port) > 0
  const sendsOrNot = fields.smtpHost.trim() === '' || Number(fields.smtpPort) > 0
  return reads && sendsOrNot
}

/** The account's own form as a patch: what the user changed, or typed again as it was, which is the same. */
export function patchFromEdit(account: Account, fields: EditFields): AccountPatch {
  const email = fields.email.trim()
  const sends = fields.smtpHost.trim() !== ''
  return {
    displayName: fields.displayName.trim() || email || account.displayName,
    emailAddress: email,
    color: fields.color,
    imapHost: fields.host.trim(),
    imapPort: Number(fields.port),
    imapSecure: fields.secure,
    imapUsername: fields.username.trim(),
    ...(fields.password !== '' ? { password: fields.password } : {}),
    smtpHost: sends ? fields.smtpHost.trim() : null,
    smtpPort: sends ? Number(fields.smtpPort) : null,
    smtpSecure: sends ? fields.smtpSecure : null,
    smtpUsername: sends && fields.smtpUsername.trim() !== '' ? fields.smtpUsername.trim() : null,
    smtpPassword: sends ? (fields.smtpPassword !== '' ? fields.smtpPassword : account.smtpPassword) : null
  }
}

/** What of a change has to be tried against a server before it is kept: the login for reading, and the login for sending. Only what changed is tried. */
export function connectionsChanged(before: Account, after: Account): { reading: boolean; sending: boolean } {
  const reading =
    before.imapHost !== after.imapHost ||
    before.imapPort !== after.imapPort ||
    before.imapSecure !== after.imapSecure ||
    before.imapUsername !== after.imapUsername ||
    before.password !== after.password
  const was = smtpSettingsOf(before)
  const now = smtpSettingsOf(after)
  return { reading, sending: now !== undefined && JSON.stringify(was) !== JSON.stringify(now) }
}
