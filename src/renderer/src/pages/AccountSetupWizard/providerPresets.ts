import type { SecureMode } from '@peregrine/core/types'

export interface ProviderPreset {
  id: string
  label: string
  imapHost: string
  imapPort: number
  imapSecure: SecureMode
  smtpHost: string
  smtpPort: number
  smtpSecure: SecureMode
  matchDomains: string[]
  /** Where to send the user to generate an app-specific password, if this provider needs one. */
  appPasswordUrl?: string
}

export const providerPresets: ProviderPreset[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: 'tls',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: 'tls',
    matchDomains: ['gmail.com', 'googlemail.com'],
    appPasswordUrl: 'https://myaccount.google.com/apppasswords'
  },
  {
    id: 'outlook',
    label: 'Outlook / Microsoft 365',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: 'tls',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: 'starttls',
    matchDomains: ['outlook.com', 'hotmail.com', 'live.com'],
    appPasswordUrl: 'https://account.microsoft.com/security'
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: 'tls',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: 'tls',
    matchDomains: ['yahoo.com', 'yahoo.de', 'ymail.com'],
    appPasswordUrl: 'https://login.yahoo.com/account/security'
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: 'tls',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: 'starttls',
    matchDomains: ['icloud.com', 'me.com', 'mac.com'],
    appPasswordUrl: 'https://appleid.apple.com/account/manage'
  },
  {
    id: 'gmx',
    label: 'GMX',
    imapHost: 'imap.gmx.net',
    imapPort: 993,
    imapSecure: 'tls',
    smtpHost: 'mail.gmx.net',
    smtpPort: 587,
    smtpSecure: 'starttls',
    matchDomains: ['gmx.de', 'gmx.net', 'gmx.com']
  },
  {
    id: 'webde',
    label: 'web.de',
    imapHost: 'imap.web.de',
    imapPort: 993,
    imapSecure: 'tls',
    smtpHost: 'smtp.web.de',
    smtpPort: 587,
    smtpSecure: 'starttls',
    matchDomains: ['web.de']
  }
]

export function findPresetForEmail(email: string): ProviderPreset | undefined {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return undefined
  return providerPresets.find((preset) => preset.matchDomains.includes(domain))
}
