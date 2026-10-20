import type { SecureMode } from '@peregrine/core/types'
import type { Account, NewAccount } from '../accounts'

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
export function withImapSecurity(fields: FormFields, secure: FormSecurity): FormFields {
  return { ...fields, secure, port: IMAP_PORTS[secure] }
}

/** The same for sending. */
export function withSmtpSecurity(fields: FormFields, smtpSecure: FormSecurity): FormFields {
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
