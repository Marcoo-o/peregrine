# Contributing

Thank you for looking. This file says what is expected of a change so that a pull request does
not stall on things nobody wrote down.

## The workflow, in order

**1. Open an issue first.** Before writing any code, describe what you intend to change and
why. This is not paperwork: it is where a plan gets corrected while correcting it is still
cheap. An issue costs a minute and can save a weekend spent on an approach that was never going
to be merged. It also gives the change a number that the branch, the commits and the pull
request can all point at, so a year later the reasoning is one click away from the code.

Use the issue to say what you observed, not only what you want built. "Attachments over 20 MB
fail silently" is something anybody can verify; "add a size check" is already a solution, and
possibly the wrong one.

**2. Branch from `main`.** One branch per issue, named after it:

```
git switch main
git pull
git switch -c 42-attachment-size-limit
```

Never commit to `main` directly. Not because a rule says so, but because a branch is what makes
a change reviewable, revertable and abandonable. Work sitting on `main` is none of those.

**3. Commit as you go**, in the style below. Small commits that each do one thing are easier to
review and far easier to undo than one large one.

**4. Open a pull request** and write "Closes #42" in its description, which links the two and
closes the issue when the branch lands.

## Getting set up

```
npm install
npm run dev
```

Node 22.12 or newer. No compiler is needed; see the note in the README.

## Before you open a pull request

```
npm run typecheck
npm test
npm run build
```

All three have to pass. They run on every pull request as well, on Windows against Node 22 and
24, and again on both platforms when the branch lands and the installers are built. Running
them first saves a round trip.

## Commit messages

A gitmoji, a space, then a summary line in the imperative under 72 characters. Then a blank
line, then the body.

```
✨ Let a queued action be taken back

Everything done without a connection was already visible as a count in the
top bar, but the count was all there was. Changing one's mind about a move
meant moving the message somewhere else again, which queues a second action
rather than removing the first.
```

The emoji is a category you can see at a glance in `git log --oneline`. The ones this project
uses:

| Emoji | Code | For |
| --- | --- | --- |
| ✨ | `:sparkles:` | A new feature |
| 🐛 | `:bug:` | A bug fix |
| ♻️ | `:recycle:` | Restructuring that changes no behaviour |
| ⚡️ | `:zap:` | A performance change, with the measurement in the body |
| 🔒️ | `:lock:` | Anything touching security |
| 💄 | `:lipstick:` | Interface and styling |
| ♿️ | `:wheelchair:` | Accessibility |
| 🌐 | `:globe_with_meridians:` | Translations |
| ✅ | `:white_check_mark:` | Tests, when they are the point of the change |
| 📝 | `:memo:` | Documentation |
| 👷 | `:construction_worker:` | Build and CI |
| ⬆️ | `:arrow_up:` | Dependency upgrades |
| 🔥 | `:fire:` | Removing code or files |

Pick the one that describes the change, not the file that happens to hold it. A translation fix
inside a component is 🌐, not 💄.

**The body explains the reason for the change, not its content.** A diff shows what moved. What
it cannot show is what was wrong before, what else was tried, and how the result was verified.
If a number changed, name the measurement. If you rejected an approach, say which and why, so
the next person does not spend a day rediscovering that it does not work.

Same prose rules as below: no dashes for punctuation, no semicolons, English.

## Comments

Comments say **why**, not what. The code already says what it does, and a comment that repeats
it goes stale the first time anyone edits the line above.

What a good comment here looks like:

* It names the alternative that was rejected and the reason. Someone will otherwise try that
  alternative again next year.
* It carries the measurement when a number came from one. `440` means nothing on its own.
  `440, because below that the subject and the correspondents stop being readable at the same
  time` means something.
* It warns about the trap. If a change to this line breaks something three files away, say so
  here, because that is where the change will be made.

Prose style, so the whole project reads as one voice:

* English throughout, in code and in documentation.
* No dashes standing in for punctuation. Use a comma, a colon or a full stop.
* No semicolons in prose. Two sentences are clearer than one long one.
* Write out what a name abbreviates the first time it appears in a file.

## Tests

Pure logic belongs in `packages/core` and gets a test. That package may import nothing but its
own files, and is typechecked without Node or DOM types, so the build fails on `Buffer`,
`window` or a stray import of `electron`. Anything reachable without a database or a
network connection should be reachable without them in the test suite too.

A test earns its place by describing a failure that could actually happen. Prefer one test that
states the risk in its name over five that restate the implementation.

Verify against reality where you can. A parser written from a specification and tested only
against fixtures you invented yourself proves that you are consistent, not that you are right.
The Rspamd and vCard parsers here were both checked against real files before being trusted.

## Translations

Every string lives in `src/renderer/src/i18n/locales/`. English is the reference; a key added
there has to be added to all the others, because i18next falls back silently and a missing key
shows an English sentence in the middle of a translated window rather than an error. A test
holds the files against each other, including the interpolations inside each string.

Two small tables in the main process are translated separately, in
`src/main/accounts/notificationTexts.ts` and `src/main/spellcheck.ts`. Notifications and the
editing context menu are built where i18next is not available.

## Privacy is a design constraint, not a feature

This program reads other people's mail on someone's behalf. Two rules follow, and a change that
breaks either of them will be refused however useful it is otherwise:

* **Nothing about a message leaves the machine without being asked for.** Remote images are
  blocked, the spell checker runs locally, and spam scores are read from headers the server
  already wrote rather than looked up against a blocklist that would learn who writes to this
  mailbox. If a feature needs to ask a third party something, that is a decision for the user
  to make explicitly, not a default.
* **Every message is hostile input.** It arrived from a stranger and was written to be
  persuasive. Sanitise before rendering, refuse before executing, and put the judgement in the
  main process where the renderer cannot talk it out of it.

## Design notes

`IDEAS.md` lists what is still open, along with the practical notes for working on this. Why a
change was made belongs in its commit message, which is why those are expected to be written
properly. Someone reading a line in a year gets its reasoning from `git log -p` on that file.

## Reporting a security issue

Please do not open a public issue for anything that affects the safety of stored mail,
credentials or keys. Use GitHub's private vulnerability reporting on the repository instead, so
the problem can be fixed before it is described in the open.
