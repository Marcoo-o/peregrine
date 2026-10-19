import { readFileSync } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseThunderbirdAccounts, type ImportableAccount } from '@peregrine/core/thunderbirdPrefs'

/**
 * Finds a Thunderbird profile and reads its accounts.
 *
 * Only ever reads. Nothing here writes into a Thunderbird profile, and nothing touches the
 * password store. Users keep Thunderbird installed while they try something new, and an
 * importer that leaves marks in the old program is one nobody would run twice.
 */

/** Where Thunderbird keeps profiles, per platform. */
function profileRoots(): string[] {
  const home = homedir()
  switch (process.platform) {
    case 'win32':
      return [join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Thunderbird')]
    case 'darwin':
      return [join(home, 'Library', 'Thunderbird')]
    default:
      return [join(home, '.thunderbird'), join(home, '.mozilla-thunderbird')]
  }
}

/**
 * Reads the default profile out of `profiles.ini`.
 *
 * Guessing by folder name would be wrong often enough to matter: `.default` and
 * `.default-release` both exist on most installations, and the stale one is usually empty.
 */
function defaultProfileFrom(root: string): string | null {
  const iniPath = join(root, 'profiles.ini')
  if (!existsSync(iniPath)) return null

  let ini: string
  try {
    ini = readFileSync(iniPath, 'utf8')
  } catch {
    return null
  }

  // Newer versions record the choice in an [Install...] section, which wins over the
  // Default=1 flag. That one can still point at a profile from an older release.
  const installDefault = /^\[Install[^\]]*\][^[]*?^Default=(.+)$/ms.exec(ini)
  const sections = ini.split(/^\[/m)

  const candidates: string[] = []
  if (installDefault) candidates.push(installDefault[1].trim())

  for (const section of sections) {
    if (!/^Profile/i.test(section)) continue
    const path = /^Path=(.+)$/m.exec(section)?.[1]?.trim()
    if (!path) continue
    const isRelative = /^IsRelative=1$/m.test(section)
    const full = isRelative ? join(root, path) : path
    if (/^Default=1$/m.test(section)) candidates.unshift(full)
    else candidates.push(full)
  }

  for (const candidate of candidates) {
    const full = candidate.includes(':') || candidate.startsWith('/')
      ? candidate
      : join(root, candidate)
    if (existsSync(join(full, 'prefs.js'))) return full
  }
  return null
}

/** Last resort when profiles.ini is unreadable: any profile folder that has a prefs.js. */
function anyProfileFrom(root: string): string | null {
  const profilesDir = join(root, 'Profiles')
  const base = existsSync(profilesDir) ? profilesDir : root
  try {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(base, entry.name)
      if (existsSync(join(candidate, 'prefs.js'))) return candidate
    }
  } catch {
    return null
  }
  return null
}

export function findThunderbirdProfile(): string | null {
  for (const root of profileRoots()) {
    if (!existsSync(root)) continue
    const profile = defaultProfileFrom(root) ?? anyProfileFrom(root)
    if (profile) return profile
  }
  return null
}

export interface ThunderbirdScan {
  /** Null when no installation was found at all. */
  profilePath: string | null
  accounts: ImportableAccount[]
}

export function scanThunderbird(explicitProfilePath?: string): ThunderbirdScan {
  const profilePath = explicitProfilePath ?? findThunderbirdProfile()
  if (!profilePath) return { profilePath: null, accounts: [] }

  try {
    const prefs = readFileSync(join(profilePath, 'prefs.js'), 'utf8')
    return { profilePath, accounts: parseThunderbirdAccounts(prefs) }
  } catch (err) {
    console.error('reading Thunderbird prefs failed:', err instanceof Error ? err.message : err)
    return { profilePath, accounts: [] }
  }
}
