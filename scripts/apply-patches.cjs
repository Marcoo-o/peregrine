#!/usr/bin/env node
// Applies the patches in `patches/` to the packages in node_modules, after an install:
//
//     node scripts/apply-patches.cjs
//
// A patch is a plain `git apply` file named `<package>+<version>.patch`, with paths from the root of the repository (`a/node_modules/<package>/...`). It exists for what
// a package has not done yet and the application cannot do without; the file says why, and the patch is removed when the package does it itself. This is run by
// `npm install` and `npm ci` (the `postinstall` of the root package) and by `npm run setup`, which installs without scripts and runs `scripts/postinstall.js`.
//
// For each patch: already applied is left as it is, so it can be run again and again; one that applies is applied; one that does neither (the package changed under
// it, usually because it was updated) stops with an error that says so, since a build with the patch half there fails in a way that is harder to read.
const { spawnSync } = require('node:child_process')
const { existsSync, readdirSync } = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const directory = path.join(root, 'patches')

function git(args) {
  return spawnSync('git', ['apply', '--ignore-whitespace', ...args], { cwd: root, encoding: 'utf8' })
}

function applyPatches() {
  if (!existsSync(directory)) return 0
  let failed = 0
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.patch')).sort()) {
    const file = path.join(directory, name)
    // "Reversible" means that it is applied already.
    if (git(['--check', '--reverse', file]).status === 0) {
      console.log(`[patches] ${name}: applied already`)
    } else if (git(['--check', file]).status === 0 && git([file]).status === 0) {
      console.log(`[patches] ${name}: applied`)
    } else {
      console.error(`[patches] ${name} does not apply: the package it is for has changed (was it updated?). Redo the patch for the new version, or remove it if the package does this now.`)
      failed += 1
    }
  }
  return failed
}

if (require.main === module) process.exit(applyPatches() === 0 ? 0 : 1)
module.exports = { applyPatches }
