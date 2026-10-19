import { describe, expect, it } from 'vitest'
import { parsePrefs, parseThunderbirdAccounts } from './thunderbirdPrefs'

/**
 * Shaped exactly like a real prefs.js, down to the account numbering being neither
 * consecutive nor in order. Which is how Thunderbird actually leaves it after accounts have
 * been added and removed over the years.
 */
const PREFS = `
# Mozilla User Preferences
user_pref("mail.accountmanager.accounts", "account1,account4,account2,account9");
user_pref("mail.smtp.defaultserver", "smtp1");

user_pref("mail.account.account1.identities", "id1");
user_pref("mail.account.account1.server", "server2");
user_pref("mail.server.server2.hostname", "mail.example.com");
user_pref("mail.server.server2.name", "anna@example.com");
user_pref("mail.server.server2.port", 993);
user_pref("mail.server.server2.socketType", 3);
user_pref("mail.server.server2.type", "imap");
user_pref("mail.server.server2.userName", "anna@example.com");
user_pref("mail.server.server2.directory-rel", "[ProfD]ImapMail/mail.example.com");
user_pref("mail.identity.id1.fullName", "Anna Meier");
user_pref("mail.identity.id1.smtpServer", "smtp1");
user_pref("mail.identity.id1.useremail", "anna@example.com");
user_pref("mail.smtpserver.smtp1.hostname", "mail.example.com");
user_pref("mail.smtpserver.smtp1.port", 465);
user_pref("mail.smtpserver.smtp1.try_ssl", 3);
user_pref("mail.smtpserver.smtp1.username", "anna@example.com");

user_pref("mail.account.account4.identities", "id4");
user_pref("mail.account.account4.server", "server7");
user_pref("mail.server.server7.hostname", "pop.altmodisch.example");
user_pref("mail.server.server7.type", "pop3");
user_pref("mail.server.server7.socketType", 2);
user_pref("mail.identity.id4.useremail", "alt@altmodisch.example");
user_pref("mail.identity.id4.smtpServer", "smtp1");

user_pref("mail.account.account2.identities", "id2");
user_pref("mail.account.account2.server", "server5");
user_pref("mail.server.server5.hostname", "imap.gmail.com");
user_pref("mail.server.server5.type", "imap");
user_pref("mail.server.server5.socketType", 3);
user_pref("mail.server.server5.authMethod", 10);
user_pref("mail.server.server5.userName", "jemand@gmail.com");
user_pref("mail.identity.id2.useremail", "jemand@gmail.com");
user_pref("mail.identity.id2.smtpServer", "smtp2");
user_pref("mail.smtpserver.smtp2.hostname", "smtp.gmail.com");
user_pref("mail.smtpserver.smtp2.port", 465);

user_pref("mail.account.account9.server", "server1");
user_pref("mail.server.server1.type", "none");
user_pref("mail.server.server1.hostname", "Local Folders");
`

describe('parsePrefs', () => {
  it('reads strings, numbers and booleans', () => {
    const prefs = parsePrefs(
      'user_pref("a.b", "text");\nuser_pref("a.c", 993);\nuser_pref("a.d", true);'
    )
    expect(prefs.get('a.b')).toBe('text')
    expect(prefs.get('a.c')).toBe(993)
    expect(prefs.get('a.d')).toBe(true)
  })

  it('unescapes the backslashes in Windows paths', () => {
    const prefs = parsePrefs('user_pref("x.dir", "C:\\\\Users\\\\anna\\\\Mail");')
    expect(prefs.get('x.dir')).toBe('C:\\Users\\anna\\Mail')
  })

  it('handles a quote inside a value', () => {
    expect(parsePrefs('user_pref("x.y", "sagt \\"hallo\\"");').get('x.y')).toBe('sagt "hallo"')
  })

  it('ignores comments and blank lines', () => {
    expect(parsePrefs('# Mozilla User Preferences\n\nuser_pref("a", 1);').size).toBe(1)
  })
})

describe('parseThunderbirdAccounts', () => {
  const accounts = parseThunderbirdAccounts(PREFS)

  it('keeps the order Thunderbird lists, not the numbering', () => {
    expect(accounts.map((a) => a.key)).toEqual(['account1', 'account4', 'account2'])
  })

  // "Local Folders" is not a mailbox; reporting it as un-importable would be noise.
  it('leaves the Local Folders pseudo-account out entirely', () => {
    expect(accounts.some((a) => a.key === 'account9')).toBe(false)
  })

  it('takes over a plain IMAP account completely', () => {
    expect(accounts[0]).toEqual({
      key: 'account1',
      displayName: 'Anna Meier',
      emailAddress: 'anna@example.com',
      imapHost: 'mail.example.com',
      imapPort: 993,
      imapSecure: 'tls',
      imapUsername: 'anna@example.com',
      smtpHost: 'mail.example.com',
      smtpPort: 465,
      smtpSecure: 'tls',
      smtpUsername: 'anna@example.com',
      directoryRel: 'ImapMail/mail.example.com',
      blockers: []
    })
  })

  // The marker only means "the profile folder"; keeping it would make the path unjoinable.
  it('strips the [ProfD] marker off the mail directory', () => {
    expect(accounts[0].directoryRel).toBe('ImapMail/mail.example.com')
  })

  it('leaves the directory empty for an account that never recorded one', () => {
    expect(accounts.find((a) => a.key === 'account4')?.directoryRel).toBe('')
  })

  it('names POP3 as the reason rather than importing it as IMAP', () => {
    expect(accounts.find((a) => a.key === 'account4')?.blockers).toContain('pop3')
  })

  it('names OAuth2 as the reason', () => {
    expect(accounts.find((a) => a.key === 'account2')?.blockers).toContain('oauth2')
  })

  it('falls back to the default outgoing server when the identity names none', () => {
    const prefs = PREFS.replace('user_pref("mail.identity.id1.smtpServer", "smtp1");', '')
    expect(parseThunderbirdAccounts(prefs)[0].smtpHost).toBe('mail.example.com')
  })

  it('derives the port from the encryption when none was stored', () => {
    const prefs = PREFS.replace('user_pref("mail.server.server2.port", 993);', '').replace(
      'user_pref("mail.server.server2.socketType", 3);',
      'user_pref("mail.server.server2.socketType", 2);'
    )
    const account = parseThunderbirdAccounts(prefs)[0]
    expect(account.imapSecure).toBe('starttls')
    expect(account.imapPort).toBe(143)
  })

  it('falls back to the server name when the identity has no full name', () => {
    const prefs = PREFS.replace('user_pref("mail.identity.id1.fullName", "Anna Meier");', '')
    expect(parseThunderbirdAccounts(prefs)[0].displayName).toBe('anna@example.com')
  })

  it('reports an account without a usable host instead of importing it half-formed', () => {
    const prefs = PREFS.replace('user_pref("mail.server.server2.hostname", "mail.example.com");', '')
    expect(parseThunderbirdAccounts(prefs)[0].blockers).toContain('incomplete')
  })

  it('returns nothing for a file that is not a prefs.js', () => {
    expect(parseThunderbirdAccounts('irgendetwas anderes')).toEqual([])
  })
})
