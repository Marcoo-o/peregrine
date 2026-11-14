const { execSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
const electronExe = path.join(electronDir, 'dist', 'electron.exe')

if (!existsSync(electronExe)) {
  console.log('[setup] Downloading electron binary...')
  execSync('node install.js', { cwd: electronDir, stdio: 'inherit' })
}

// better-sqlite3-multiple-ciphers builds on Node-API since 13.0.0 and ships a prebuilt
// binary for every platform in the package itself, picked at runtime. There is nothing
// left to rebuild against the Electron ABI.

// What `npm install` does by itself with scripts on: the patches to packages (see patches/ and scripts/apply-patches.cjs).
execSync('node scripts/apply-patches.cjs', { cwd: path.join(__dirname, '..'), stdio: 'inherit' })
