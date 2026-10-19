import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const packages = join(__dirname, '..', '..', 'packages')

/**
 * What each package may ask for, besides its own files. `core` stands on nothing. `imap` may use
 * `core`, because the interface it implements lives there, and nothing else.
 */
const ALLOWED: Record<string, string[]> = {
  core: [],
  imap: ['@peregrine/core/']
}

/** Every module name a file asks for, by `import`, `export … from`, `import()` or `require`. */
export function specifiersOf(text: string): string[] {
  const found: string[] = []
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1])
  }
  return found
}

function sourcesOf(name: string): string[] {
  return readdirSync(join(packages, name, 'src')).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts')
  )
}

// The packages are what a phone application shares with the desktop one. A single import of
// `electron` or `node:fs` would not fail anywhere until somebody built the phone, which is the
// worst place to find out. So a package imports its own files and, where it is listed above,
// another package of ours, and nothing else: no platform module, and no dependency that would
// have to be installed, vetted and shipped on both sides.
describe('the portable packages', () => {
  it('are all accounted for', () => {
    expect(readdirSync(packages).sort()).toEqual(Object.keys(ALLOWED).sort())
  })

  for (const [name, allowed] of Object.entries(ALLOWED)) {
    describe(name, () => {
      it('has source files to look at', () => {
        expect(sourcesOf(name).length).toBeGreaterThan(5)
      })

      it('imports nothing it is not allowed to', () => {
        const offenders = sourcesOf(name).flatMap((file) =>
          specifiersOf(readFileSync(join(packages, name, 'src', file), 'utf8'))
            .filter((specifier) => !specifier.startsWith('./') && !allowed.some((p) => specifier.startsWith(p)))
            .map((specifier) => `${file} imports ${specifier}`)
        )
        expect(offenders).toEqual([])
      })
    })
  }

  // The detector itself, so that a pattern that stopped matching would not pass for a clean tree.
  it('recognise the ways a module can be pulled in', () => {
    expect(specifiersOf("import { app } from 'electron'")).toEqual(['electron'])
    expect(specifiersOf("import type { X } from 'node:fs'")).toEqual(['node:fs'])
    expect(specifiersOf("export { y } from 'openpgp'")).toEqual(['openpgp'])
    expect(specifiersOf("import 'side-effect'")).toEqual(['side-effect'])
    expect(specifiersOf("const m = await import('node:path')")).toEqual(['node:path'])
    expect(specifiersOf("const m = require('fs')")).toEqual(['fs'])
    expect(specifiersOf("import {\n  a,\n  b\n} from './local'")).toEqual(['./local'])
  })
})
