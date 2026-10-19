const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

// This folder is an npm workspace, so what it depends on is installed in the node_modules at the
// root of the repository, and the packages it shares with the desktop live next to it. Metro only
// looks inside the project by default, so it is told about both.
const root = path.resolve(__dirname, '../..')

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.join(root, 'node_modules')],
    // @peregrine/core and @peregrine/imap say where their files are in `exports`
    unstable_enablePackageExports: true
  }
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
