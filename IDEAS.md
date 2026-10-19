# Peregrine – open ideas

Finished work lives in the git history, not here. This file is only for what is
still open: ideas not yet planned, known small gaps, and practical notes for
whoever picks up the next piece of work.

## Not yet planned

- **A phone client, beyond the prototype.** There is an Android prototype in `apps/mobile` that
  signs in to one account, lists its folders and messages and reads one. It is a second program,
  because Electron does not run on Android, and what it found and what is still open is in
  [docs/mobile.md](docs/mobile.md): sending, attachments, an offline queue, several accounts and
  notifications by periodic sync are the stages after it.

  A phone can hold an IMAP connection open in the background. An Android foreground service does
  that indefinitely, which is how K-9 and FairEmail have done IMAP IDLE for years. It costs a
  permanent notification and battery, and the rules around it tighten with most Android releases,
  but no server is required.
- **macOS builds.** Gatekeeper refuses to launch an unsigned application rather
  than warning about it, so an unsigned macOS artifact is a download nobody can
  open. Needs an Apple developer account (99 EUR a year) and a signing identity
  before it is worth producing at all.
- Observed, not investigated: three older messages in "Sent" show
  `encrypted-failed`, likely from before the own copy was also encrypted to the
  own key. If so, they are unreadable by design and there is nothing to fix.
- Observed, not investigated: one of twelve accounts reports a connection error
  at startup while the other eleven connect. Reproduced with and without the
  STARTTLS change, so it predates that and lies elsewhere.

## Smaller gaps

- No OAuth2 for Gmail/Outlook. `auth_type`/`oauth_*` exist only in the schema.
  Autodiscovery recognises and reports such accounts, but setup does not work
  yet. Google requires a security audit before a client may use the IMAP scope
  for anyone but a hundred hand-listed test accounts, which is why the setup
  wizard guides people to an app password instead. Microsoft has no such
  requirement, and its business accounts have password sign-in switched off
  entirely, so that half is worth doing on its own.
- Contacts know name, email and frequency. vCard import and export exist, but
  no groups and no fields beyond those three.
- The filter rule import refuses negated operators, forwards, and moves whose
  target folder is not synced. Named per rule, but still a gap.
- Attachments of decrypted messages land in the attachment cache as plaintext
  once opened (cleared automatically after 30 days, or by hand under privacy
  settings).
- The spam verdict is read but not acted on: it appears in the warning banner
  and nowhere else. It could sort, filter or feed a column, and a message the
  server called spam could be marked in the list without opening it.

## Notes for further work

- Reading the live database only works from inside Electron, since the native
  SQLCipher module is built for it. A throwaway project (`package.json` +
  `main.js`, started with `node_modules/electron/dist/electron.exe <folder>`)
  is enough for that. The file lives under
  `%APPDATA%/peregrine/profiles/<profile-id>/peregrine.db`; `profiles.json`
  one level up says whether the profile is encrypted.
- Electron writes nothing to stdout on Windows when started without a console,
  so a throwaway script has to write its findings to a file to be readable.
- To check something database-adjacent without starting the app, and so
  without a single connection to a mail server: bundle the functions under
  test into CJS with the esbuild already in the tree and load that bundle from
  the throwaway project.
  ```
  ./node_modules/.bin/esbuild entry.ts --bundle --platform=node --format=cjs \
    --outfile=repo.cjs --alias:@shared=./src/shared --external:better-sqlite3-multiple-ciphers
  ```
  This checks the real code instead of a copy typed out by hand.
- For driving the running application, Electron's own remote debugging port and
  the Chrome DevTools Protocol are enough and need nothing installed:
  `electron.exe . --remote-debugging-port=9229`, then `Runtime.evaluate` for
  state, `Input.dispatchKeyEvent` for real key presses and
  `Accessibility.getFullAXTree` for what a screen reader would actually read.
  Point it at `.` rather than at `out/main/index.js`, or Electron falls back to
  a different application name and opens an empty profile.
- The npm bundled with a Node release is not the npm that wrote the lockfile.
  Both CI workflows pin npm explicitly for that reason.
- Shared files (`packages/core/**`, `src/shared/**`, `src/preload/**`, `styles.css`, the i18n
  JSON files) are the usual point of conflict between features; feature-owned
  stylesheets already live separately under `src/renderer/src/styles/`.
