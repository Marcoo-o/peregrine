# Peregrine

An email client for people who keep more than one mailbox. A desktop application in Electron,
TypeScript and React, with IMAP and SMTP for several accounts from the start. An Android client
exists as a prototype that signs in, lists folders and messages and reads one, see
[docs/mobile.md](docs/mobile.md).

## What it does

* **Several mailboxes at once.** A unified view folds the standard folders of every account
  into one tree, and every account keeps its own colour.
* **Encrypted profiles.** A profile can carry a password, and then the whole database is
  encrypted with SQLCipher. Without it the application cannot reach a single credential.
* **OpenPGP.** Sign, encrypt, decrypt and verify, with a keyring per account and per contact.
* **Works offline.** Actions taken without a connection are recorded and replayed later, and
  the interface says what is still waiting.
* **Full text search** over subject, body and correspondents, with saved searches that behave
  like folders.
* **Taking over from Thunderbird.** Accounts, address books, filter rules and OpenPGP keys.
* **Spam scores from your own server.** The verdict the delivering server already wrote into
  the headers, shown with the findings behind it. Nothing is looked up against a blocklist.
* **Nothing phones home.** No telemetry, no update check. Remote images and tracking pixels
  are blocked until you say otherwise.
* **Five languages.** English, German, Spanish, French and Portuguese.

## Running it

Node.js 22.12 or newer, then:

```
npm install
npm run dev
```

No compiler is needed, the database driver ships a prebuilt binary per platform. If npm's
lifecycle scripts have to be skipped, `npm run setup` installs that way and fetches the Electron
binary by hand.

```
npm run dev         start the application with hot reload
npm run typecheck   TypeScript for the application and for the portable package
npm test            the test suite
npm run build       build without packaging
npm run dist:win    build a Windows installer
npm run dist:linux  build an AppImage and a .deb
```

## How the code is laid out

```
src/main         the Electron main process: database, IMAP, SMTP, OpenPGP, IPC handlers
src/preload      the bridge, one narrow API surface, no Node access in the renderer
src/renderer     the React application
src/shared       the IPC contracts, which both sides of the bridge compile against
packages/core    types and pure logic with no platform behind them
```

Every IPC channel is declared once in `src/shared/ipcContracts.ts` and mirrored in the preload
bridge, so a channel that exists on one side but not the other does not compile.
`packages/core` is an npm workspace, `@peregrine/core`, checked on its own without Node or DOM
types and allowed to import nothing but its own files, so a second application can share it.

## Builds

Every pull request is type checked, tested and built on Windows. Every commit on `main` builds
the Windows installer and the Linux packages and replaces the `nightly` pre-release. A tag
starting with `v` does the same into a draft release. Each build job writes the SHA-256 of its
files into the release text. Nothing is signed. The Android application is built and tested on
every change to it, as a debug APK that is not part of a release yet. [docs/building.md](docs/building.md) has the details, including signing and what
to do on a new machine.

## Contributing and security

Open an issue before writing code, branch from `main` for it, and prefix commits with a
gitmoji. [CONTRIBUTING.md](CONTRIBUTING.md) has the rest, including the two privacy constraints
a change has to respect, and [IDEAS.md](IDEAS.md) lists what is still open. Every message is
treated as hostile input: [SECURITY.md](SECURITY.md) says what that means and where
vulnerabilities go.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
