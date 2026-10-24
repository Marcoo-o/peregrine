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
    unstable_enablePackageExports: true,
    // OpenPGP has a build for Node, which `exports` would give here and which needs Node's modules, and a build for browsers
    // (all in one file, the cryptography in JavaScript) that does not. The second is the one for this runtime, in its module
    // form: the file for browsers that is not one exports nothing to anything but a page.
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'openpgp') {
        return { type: 'sourceFile', filePath: path.join(root, 'node_modules', 'openpgp', 'dist', 'openpgp.min.mjs') }
      }
      return context.resolveRequest(context, moduleName, platform)
    }
  }
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
