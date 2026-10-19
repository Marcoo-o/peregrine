import { describe, expect, it } from 'vitest'
import { folderPathFromImapUrl, parseThunderbirdFilters } from './thunderbirdFilters'

/** A file the way Thunderbird writes it: a header, then one block per rule. */
const FILE = [
  'version="9"',
  'logging="no"',
  'name="Rechnungen"',
  'enabled="yes"',
  'type="17"',
  'action="Move to folder"',
  'actionValue="imap://john%40example.com@mail.example.com/Rechnungen/2026"',
  'condition="AND (from,contains,buchhaltung@lieferant.example) AND (subject,contains,Rechnung)"',
  'name="Newsletter weg"',
  'enabled="no"',
  'type="17"',
  'action="Mark read"',
  'action="Delete"',
  'condition="OR (from,contains,newsletter) OR (subject,begins with,Angebot)"'
].join('\n')

describe('parseThunderbirdFilters', () => {
  it('reads both rules with their conditions and actions', () => {
    const rules = parseThunderbirdFilters(FILE)
    expect(rules).toHaveLength(2)

    expect(rules[0]).toMatchObject({
      name: 'Rechnungen',
      enabled: true,
      matchMode: 'all',
      moveTarget: 'Rechnungen/2026',
      actions: []
    })
    expect(rules[0].conditions).toEqual([
      { field: 'from', operator: 'contains', value: 'buchhaltung@lieferant.example' },
      { field: 'subject', operator: 'contains', value: 'Rechnung' }
    ])

    expect(rules[1]).toMatchObject({
      name: 'Newsletter weg',
      enabled: false,
      matchMode: 'any',
      actions: ['markRead', 'delete']
    })
  })

  // A rule switched off in Thunderbird must not start acting on mail here.
  it('carries the disabled state over', () => {
    const rules = parseThunderbirdFilters(FILE)
    expect(rules[0].enabled).toBe(true)
    expect(rules[1].enabled).toBe(false)
  })

  it('treats a rule without an enabled line as enabled', () => {
    const file = ['name="Ohne"', 'condition="AND (subject,contains,x)"'].join('\n')
    expect(parseThunderbirdFilters(file)[0].enabled).toBe(true)
  })

  it('keeps a comma inside the value instead of splitting on it', () => {
    const file = ['name="Komma"', 'condition="AND (subject,contains,Hallo, Welt)"'].join('\n')
    expect(parseThunderbirdFilters(file)[0].conditions).toEqual([
      { field: 'subject', operator: 'contains', value: 'Hallo, Welt' }
    ])
  })

  it('undoes the escaping inside a value', () => {
    const file = ['name="Zitat"', 'condition="AND (subject,is,\\"Angebot\\")"'].join('\n')
    expect(parseThunderbirdFilters(file)[0].conditions[0].value).toBe('"Angebot"')
  })

  it('maps "to or cc" onto the recipient field', () => {
    const file = ['name="An mich"', 'condition="AND (to or cc,contains,john@example.com)"'].join('\n')
    expect(parseThunderbirdFilters(file)[0].conditions[0].field).toBe('to')
  })

  it('reports a negated operator instead of importing its opposite', () => {
    const file = ['name="Nicht"', `condition="AND (subject,isn't,Werbung)"`].join('\n')
    const rule = parseThunderbirdFilters(file)[0]
    expect(rule.conditions).toEqual([])
    expect(rule.unsupported).toContain("subject isn't")
  })

  it('reports a field it cannot express', () => {
    const file = ['name="Alt"', 'condition="AND (date,is before,01-Jan-2026)"'].join('\n')
    expect(parseThunderbirdFilters(file)[0].unsupported).toContain('date is before')
  })

  it('reports an action it cannot perform', () => {
    const file = ['name="Weiter"', 'action="Forward"', 'actionValue="chef@example.com"'].join('\n')
    const rule = parseThunderbirdFilters(file)[0]
    expect(rule.unsupported).toContain('Forward')
    expect(rule.moveTarget).toBe('')
  })

  it('reports a rule matching everything rather than importing one that matches nothing', () => {
    const file = ['name="Alles"', 'condition="ALL"', 'action="Mark read"'].join('\n')
    const rule = parseThunderbirdFilters(file)[0]
    expect(rule.conditions).toEqual([])
    expect(rule.unsupported).toContain('ALL')
  })

  it('returns nothing for an empty file', () => {
    expect(parseThunderbirdFilters('')).toEqual([])
    expect(parseThunderbirdFilters('version="9"\nlogging="no"')).toEqual([])
  })
})

describe('folderPathFromImapUrl', () => {
  it('takes the folder and leaves the account out', () => {
    expect(folderPathFromImapUrl('imap://john%40example.com@mail.example.com/Archiv/2026')).toBe(
      'Archiv/2026'
    )
  })

  it('decodes an escaped folder name', () => {
    expect(folderPathFromImapUrl('imap://user@host/Gesch%C3%A4ftlich')).toBe('Geschäftlich')
  })

  it('handles a local folder URL', () => {
    expect(folderPathFromImapUrl('mailbox://nobody@Local%20Folders/Archiv')).toBe('Archiv')
  })

  it('returns nothing when there is no folder at all', () => {
    expect(folderPathFromImapUrl('imap://user@host')).toBe('')
  })
})
