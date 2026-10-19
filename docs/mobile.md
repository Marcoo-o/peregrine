# Peregrine on Android

A scoping note, kept up to date as the stages land. No phone code has been written. Stages 1
and 2 are done on the desktop. Stage 3 is built, compared with imapflow against two real servers,
and available on the desktop behind a setting that is off by default. Nothing after it should
start until the four decisions below have answers.

## This is a second application

Electron has no Android target. It is Chromium and Node packaged for a desktop operating
system, and there is no build flag, no plugin and no fork that changes that. Nothing about the
current repository can be made to produce an APK.

So the question is not how to port Peregrine. It is how much of Peregrine a second application
could share, and whether that share is large enough to be worth the second application.

## What carries over, measured

| | Lines | On a phone |
|---|---|---|
| `src/shared`, the pure logic | 3,344 | Runs unchanged. No Electron, no Node, no crypto dependency. 28 test files come with it |
| `src/shared`, the IPC contracts | 1,134 | Describes Electron's IPC. Replaced, not moved |
| `src/shared`, the Thunderbird importers | 794 | There is no Thunderbird profile on a phone |
| `src/main` | 11,331 | Rewritten. imapflow, nodemailer, better-sqlite3 and `safeStorage` are all Node or Electron |
| `src/renderer` | 12,599 | React stays, the layout does not. Three panes with draggable splitters is not a phone |
| `src/preload` | 284 | Gone with the IPC boundary |

Roughly one line in eight runs as it is. That sounds discouraging and is not the whole picture,
because of what those 3,344 lines contain: the link forgery checks, the attachment refusal
rules, the spam header reading, the search grammar, the saved searches, the vCard parser, the
autoconfig lookup, the file type sniffing, the safe file names. That is the part of this
project that is not "another mail client", and it is the part that travels.

## The seam that already exists

Every IMAP call in the application goes through one class. `ImapConnection` is 371 lines with
21 public methods, and the entire rest of the codebase talks to those methods. Counted across
the whole tree, imapflow itself is reached exactly 19 times, all of them inside that file.

Nothing above it knows what an IMAP connection is. The sync engine, the offline queue and the
account manager all speak to those 21 methods. A phone needs a second thing that answers to
them, and everything above stays where it is.

**Corrected.** That was true of the calls and not of what they returned. The methods
handed out imapflow's own objects, and the sync engine read fields straight off them, so a second
implementation would have had to build another project's objects to be understood. One of the 21,
`fetchEnvelopes`, had no caller at all. The interface is now `ImapSession` in `packages/core`,
with types of our own, and twenty methods.

That is worth stating plainly because it decides how expensive this is. Most of what a mail
client does with a mailbox is already behind an interface. It was not built for this, it came
out of keeping imapflow's peculiarities in one place, and it happens to be the thing that makes
a second front end thinkable.

## Four decisions, in the order they have to be made

### 1. The runtime

**React Native** is the recommendation. TCP with TLS exists as a maintained library, SQLCipher
exists, Hermes is a current JS engine, and the pure logic above runs on it untouched.

**Capacitor** would keep more of the React code, since it is a WebView. That advantage is
smaller than it looks. The desktop layout has to be rebuilt for a phone regardless, and what
survives a rebuild is the state handling and the pure logic, which survives either choice.

**nodejs-mobile** embeds a Node runtime in the app and would rescue imapflow, better-sqlite3
and the whole main process almost unchanged. It is the tempting shortcut and it is the one to
check hardest before taking. It has trailed current Node by a long way for years. A mail client
sitting on an unmaintained runtime is a security problem with a timer on it, and this project
promises the opposite of that in SECURITY.md.

### 2. How IMAP gets onto the phone

Three routes, and the third is the recommendation.

**A native library** behind a Kotlin bridge, Jakarta Mail or the pieces K-9 uses. Proven code,
but it is a second IMAP implementation with its own behaviour and its own bugs, and every fetch
has to cross the bridge.

**imapflow shimmed onto a React Native socket.** Tempting because it changes nothing above.
Probably a swamp: imapflow reaches for `node:stream`, `node:zlib`, `node:crypto` and
`node:buffer`, and a shim that is almost right is worse than no shim in a protocol client.

**A small IMAP client in TypeScript**, written against a socket interface, shared by both. The
measurement above is what makes this bounded rather than reckless. The application needs
CAPABILITY, LOGIN, LIST, SELECT, STATUS, FETCH, STORE, UID MOVE, UID EXPUNGE, APPEND, CREATE,
RENAME, DELETE, IDLE and LOGOUT, plus literals and the modified UTF-7 that mailbox names use.
That is a list, not an RFC.

Writing an IMAP client is where mail clients go to die, and the protection against that here is
the list. Write it desktop first, behind the existing `ImapConnection` interface, and prove it
against real accounts before a single line of phone code exists. If it cannot replace imapflow
on the desktop, it is not ready for a phone, and finding that out costs nothing extra.

**Built, behind a setting.** `packages/imap` is about 2,300 lines of source and
implements `ImapSession` over a `Transport` it is handed. The desktop's transport is about 110 lines on
Node's sockets. The parser was written against a Dovecot and not against the RFC's examples, using
a corpus of awkward messages: encoded words in several charsets, address groups, raw UTF-8
headers that the server sends as literals in the middle of an envelope, nested multiparts and
an embedded message. Four recordings are kept as fixtures.

What it was compared on: a suite runs the same nineteen scenarios through imapflow and through
the new client against one server and compares what comes back. Envelopes, attachment hints,
sizes, flags, the UIDs a move or an append reports, and the bytes of every message are the same.
The differences found were fixed or written down: `\Recent` is not reported, an open mailbox is
brought up to date before its count is read, a malformed Date header becomes no date instead of
failing the folder's sync, and an address group no longer produces a recipient called `Team@`.
The new client also starts listening for arrivals after two seconds of quiet where imapflow needs
fifteen.

The suite has been run against Dovecot 2.3 and, in the version before the last scenario below,
against one real provider's server, and passes on both. Its last scenario syncs the same folder
through the sync engine into a fresh database with each client and compares the rows, which are
the same. That one has so far only run against Dovecot. The suite is skipped without a server in
the environment, and it is safe to point at a real account, since it only touches folders it
creates.

The built-in client is chosen with a setting, `experimentalImapClient`, under Diagnostics in the
settings. It is off by default, applies the next time an account connects, and writes into the same
diagnostics log as imapflow. Turning it on for the accounts that matter, and living with it for a
while, is what remains before the default can change.

### 3. The database, and 126 synchronous functions

better-sqlite3 is synchronous by design. Every SQLite driver on Android is asynchronous. The
repository layer is 2,772 lines across 13 files, exporting 126 functions, and every one of them
is synchronous, as is every caller of every one of them.

Converting them is wide and produces a diff nobody enjoys reading. The alternative is a second
data layer for the phone, which means the same queries written twice and drifting apart, and
this project has already had one bug from exactly that shape (the attachment key that the
window rebuilt for itself). So the conversion was done on the desktop, before the phone exists,
while there is one set of callers.

The 21 migrations are plain SQL and carry over as they are.

**Done, and bigger than counted here.** Besides the 126 functions there were SQL
statements written straight into the sync engine, the credential store and several IPC
handlers (18 of them), and 20 transactions. All of it now goes through `SqlDb` in
`src/main/db/sqlDb.ts`, which has four methods: `run`, `get`, `all` and `transaction`. The
desktop implements it over better-sqlite3 as `BetterSqliteDb`. A phone implements it over
whatever driver it ends up with, and the repositories, the sync engine and the handlers do not
change. Apart from the reader for Thunderbird's address book, which opens somebody else's file,
nothing outside that one file imports the driver.

An earlier version of this section said better-sqlite3 does not object to being awaited. That
is true and it was not the hard part. Two things were:

* **Transactions.** On one connection, a transaction that spans an `await` lets any other task
  run its statements inside it, and a rollback then undoes writes that were never part of it.
  So everything else waits for an open transaction, and the function gets a handle of its own.
  Using the outer handle from inside is an error instead of a hang. Whatever drives SQLite on
  the phone has to give the same guarantee, and `sqlDb.test.ts` is the specification of it.
* **Read, then write.** Seventeen functions looked something up and then wrote on the
  strength of it: the next sort position, a free tag keyword, whether a message is new. They
  were one step only because the driver was synchronous. Each now opens a transaction, and a
  transaction asked for inside another one joins it. Eight tests fail with UNIQUE constraint
  errors when that is taken away, which is how the claim was checked.

The repositories are now tested against a real in-memory database with every migration applied.
The old note in the test configuration, that the driver cannot load outside Electron, was out of
date since the driver moved to Node-API.

Still open for the phone: seven statements bind parameters by name (`@id`), which better-sqlite3
accepts and a mobile driver may not.

### 4. Where the shared code lives

Not by copying. A copy of the link checker that fixes a hole in one place and not the other is
the worst outcome available here.

```
peregrine/
  packages/core      the portable logic, 3,344 lines and 28 test files
  packages/imap      the client from decision 2
  packages/smtp      sending: an SMTP client over the same transport, and a message composer
  apps/desktop       today's src/main and src/renderer
  apps/mobile        the React Native application
```

npm workspaces are enough. The cost is one pass over the desktop's import paths and build
configuration. The benefit is that a fix to the spam reader or the link checker lands in both
and is tested once.

**Done, with one change.** `packages/core` exists as `@peregrine/core` and holds
everything from `src/shared` except the two IPC files, which stay where the desktop needs them.
The desktop did not move to `apps/desktop`. Moving the sources, the build configuration and the
installer setup buys nothing a phone needs and puts the release pipeline at risk, so
`apps/mobile` will sit next to the desktop at the root instead. That can be revisited once
there is an `apps/mobile` to be tidy about.

The boundary is enforced, which the plan above did not have. The package typechecks on its own
without Node or DOM types, and a test fails on any import that is not one of its own files. The
first run found a real assumption: `linkSafety` uses `URL`, and Hermes ships one without
`hostname`, `username` and `password`, which the link forgery checks read. The phone
application has to install a complete one. `packages/core/portable-globals.d.ts` is the whole
list of what the package expects the platform to provide.

## Push, and a correction

An earlier note in this repository said a phone cannot hold a TCP connection open in the
background, so push would require a server component. That is wrong. Android lets a foreground
service keep a connection open indefinitely, and that is exactly how K-9 and FairEmail have
done IMAP IDLE for years.

What it costs is a permanent notification, battery, and a running fight with the battery
optimisation that Samsung and Xiaomi apply to anything they do not recognise.

Two things follow. The default should be periodic sync rather than push, on the platform's own
scheduler, which floors out around fifteen minutes. Push should be something the user turns on
knowing what it costs.

And the rules for foreground services have tightened with almost every Android release,
including which type an application may declare and how long it may run per day. Check the
current rules for the version being targeted before designing anything that depends on holding
a socket open. This is the item most likely to invalidate a plan written today.

A push server would avoid the notification and the battery cost. It would also be a server that
learns who writes to you and when, which is the thing SECURITY.md promises does not happen. If
it is ever built, it holds the connection and knows "something arrived for account X" and never
content, and that has to be designed in at the start rather than bolted on.

## What v1 is

Small on purpose. A phone client that tries to match the desktop feature for feature does not
ship.

In:

- Several accounts with a unified inbox. This is the point of the project and there is no
  version of it worth building that leaves this out.
- Read, reply, forward, compose, attachments.
- The offline queue. The phone is where the connection actually drops.
- Search over what is on the device.
- The safety work: link forgery checks, attachment refusal, remote content blocked until asked,
  the spam verdict from the server's own headers. This already exists and is what makes it
  Peregrine rather than one more client.

Out, for now:

- OpenPGP. openpgp.js needs a crypto polyfill on Hermes, and where a private key lives on a
  phone deserves its own design rather than a port of the desktop's.
- Filter rules, tasks, snooze, saved searches, several identities per account.
- Thunderbird import, which has nothing to read from.

## Stages

1. Make the repositories asynchronous. Desktop only, no phone code, no user-visible change.
   **Done.**
2. Split the workspace. Desktop keeps working, tests run once. **Done**, without moving
   the desktop.
3. Write the IMAP client, desktop first, behind `ImapConnection`, proven against real accounts.
   **Written, compared with imapflow against Dovecot and one real provider, and available behind
   a setting**. Making it the default remains, and waits on use.
4. First phone build: one account, list and read, nothing else. **A prototype runs** on an
   Android 16 emulator against a test server: sign in, folders, the newest messages of a
   folder, one message opened. What it found is under "What stage 4 found".
5. Send, attachments, offline queue, several accounts. **Steps 1 to 4 are written**: sending,
   in `packages/smtp`, the replay of the offline queue as an engine in `@peregrine/core`, the
   phone's data for several accounts with the queue's storage, and the application acting on mail
   through the queue and sending. The rest is not, see "What stage 5 found so far".
6. Notifications by periodic sync.
7. Push as an opt-in, if the platform rules still allow what is wanted by then.

Stages 1 to 3 improve the desktop whether or not a phone ever appears. That is the test of
whether this plan is honest rather than hopeful: if the first half only pays off when the second
half ships, it is a bet, not a plan.

## What stage 5 found so far

**Sending needs two things the desktop gets from one library.** nodemailer builds the message and
speaks SMTP, and both want Node. `packages/smtp` has the two halves apart, as the IMAP client has
its protocol apart from its socket: an SMTP client over the same `Transport`, which the phone's
native module already is, and a composer that builds the RFC 5322 source. The desktop keeps
nodemailer until a later step has proved the replacement, as it did with imapflow.

**What the client does that a quick one would not.** Encryption is not negotiable: if the server
does not offer STARTTLS, or refuses, or the handshake fails, nothing is sent, because a client that
goes on without hands the password to anybody who removes one line from the exchange. What arrived
over the clear connection after the `220` is thrown away, and the extensions are read again after
the upgrade. An address is refused, not escaped, if it could end the command and start another. The
message is written with every line end as CR LF and every line that starts with a dot doubled: a
bare line feed is a line end to some servers and not to others, which is how a message gets split
in two on the way. A test sends a message with one smuggled into it to a real server library and
sees one message arrive.

**What the composer does.** It builds the same messages nodemailer does, and the parsed result is
compared field by field with nodemailer's for seven kinds of message: plain, non-ASCII subject and
names, text with HTML, a reply in a thread, cc and bcc, attachments with names that are not ASCII,
and a line of one dot. A real parser reads all of them back as written, and a 3 MB attachment
goes through a real server whole. Everything that goes into a header is made one line first, and
an id or a reference that carries a header is refused. The result is 7-bit all the way, so any
server takes it.

**Two mistakes the tests found in the code written for this.** The server's own status code did not
decide whether to try again: every error of the kind "connection" counted as temporary, so a `554`
at the greeting, which is a no, was one to retry. And the composer looked for a boundary that was
not in the text it separates, which with a random source that keeps giving the same answer, as
tests use, never ended. It counts its tries now.

**Not in step 1.** The screens, the offline queue, attachments from the phone's files, several
accounts. In the composer: inline images (`multipart/related`), addresses with characters beyond
ASCII in a header, which want the SMTPUTF8 form of the message, and addresses whose domain is an
internationalised name. In the client: OAuth, and PGP/MIME, which the desktop sends through a
different path and which the phone does not do yet.

**The offline queue's replay was written once and tested never.** The types and the rules about what
an action is were already portable. The replay was 200 lines in the desktop that knew Electron, its
repositories and its timers, and no test touched it. It is now `QueueRunner` in `@peregrine/core`,
handed where the actions are kept, what a folder id means on the server, what to do to the local mail
after a move, how to say that something changed, and the timers. The desktop's `OfflineQueue` is a
74-line layer over it with the methods the rest of the process always called. The rules are the ones
that were in the comments, now each with a test: order kept per account and the first failure stops
the run, a target that is gone is dropped and not retried, a message is sent before it is removed and
a missing send handler fails it instead of dropping it, an action that never settles is a failed
attempt, a second run for a running account does nothing, and one timer, capped at a day, wakes the
queue for the next scheduled message. The desktop is checked against a real database with every
migration, and the same test passes against the old implementation, which is what shows that it
measures the behaviour that was there and not what was written afterwards.

**Not in step 2.** The phone's side of it, which is step 3.

**The queue's storage was already portable, apart from one call.** Adding an action, listing what is
due, counting failures, the summary and cancelling a queued move are SQL and rules, all of it with
positional parameters, which is the one thing the phone's adapter takes. They needed `SqlDb` and a way
to clear the mark of a queued move, which is a column of the desktop's messages. That is handed in
now, and the functions live in `@peregrine/core`, so the limit of attempts, the order of replay and
what counts as scheduled or given up are one thing for both sides. The desktop's file keeps its names.
The table is defined once for the phone and a test holds it to the desktop's columns and indexes, as
the desktop has them after its three migrations.

**The phone's data.** Schema version 2 has any number of accounts, folders with an id of their own,
messages keyed by folder and UID, and the queue's table. The queue names a folder by id and has to
find its path on the server, and a folder that is renamed keeps its id when it is listed again. The
prototype's account is kept with the login it was given, and its message headers, which are a cache,
are fetched again. The migration is whole or nothing, and a test makes it fail part way. Saving
messages updates a row instead of replacing it: replacing would clear the mark of a queued move, and
the message would show in the folder it is leaving. The queue runs on this data through the same
functions the desktop calls, and a test shows the limit of attempts, a folder the server no longer
lists, a scheduled message and two accounts coming out as they do there.

**What this step has not shown.** None of it was run on a device. The data layer is tested against a
real SQLite through the phone's own adapter, which is why positional parameters are enforced, and
the screens were type-checked and bundled and not exercised. The test database and op-sqlite's own
SQLite are the same version, 3.53.4. With SQLCipher compiled in, op-sqlite uses SQLCipher's source,
whose version was not checked: the upsert needs 3.24, and SQLCipher 4 is newer than that.

**Not in step 3.** Sending from the app, the offline use of the queue in the screens, attachments,
OAuth. Nothing in the screens puts anything into the queue yet: they replay it when an account
connects, which is the path that is real now.

**One path to the server.** Marking, moving, deleting and sending each change the local copy at once
and then go through the queue, and there is no second way that talks to the server directly. With
one, a decision made while older ones still wait would arrive first, and what was decided in one order
would happen in another. Through the queue alone the order is the order of the decisions, a decision
survives the application being closed, and a refusal keeps its reason and its count. With a
connection the queue is run straight away, so online it is the same as doing it directly, written
down first. Runs for one account wait for each other: the queue does nothing when asked to run twice
at once, and without that an action added while a run was reading its list would sit there until
something else ran the queue. A test holds the first of two decisions in the server and makes the
second while it is stuck.

The rest is what the desktop does, so an account behaves the same on both. A move replaces a move
that waits for the same messages. The messages stay in the list where they are, marked with where
they are going, until the server has them. A deletion goes into the trash folder where there is one
and is final in the trash itself, and it settles a move that waited for the same message.

**Sending.** The composer and the client of `packages/smtp` over the phone's transport, with the
sender and the login from the account. A user name or password that was not given for sending is the
one for reading, and a port that was not given is the one for the kind of connection. It refuses,
saying why, what the phone cannot do yet and would otherwise do wrongly: attachments, encrypting or
signing, and a later time. An answer quotes the original and joins its thread, which needed the
Message-ID, References and Reply-To of the message read out of the source. A message that went out is
filed in the account's Sent folder with IMAP `APPEND`, marked read, as most providers do not do it
themselves. The queue hands its connection to the send handler for this. The copy is made after the
server has accepted the message, and nothing that goes wrong with it fails the send: the queue would
take that for a message that did not go out and send it again, and the recipient would get it twice
for the sake of a copy. A copy that could not be made is logged.

**Screens.** Reading a message marks it read. A message has Reply, Unread, Star, Move and Delete. A
new message and an answer have a compose screen. An account whose server cannot be reached opens from
what was fetched before, with the reason, and a button to try again, and what is decided there waits.
A line at the top says that there is no connection, how many actions wait, why the first one that
failed did, and offers to discard what was given up on.

**What this step has not shown.** None of it was run on a device or a server. The queue, the actions
and the sending are tested on the phone's data and through its adapter, sending against a scripted
server, and the screens are type-checked and bundled and not used. Two things are known to be
missing or rough. The sending settings of a new account are not tried when it is added, only the
reading ones are, so a wrong SMTP server shows when the first message is sent, as a message that
waits with its reason. A message the server took for some recipients and refused for others counts
as sent, and the refusals are not shown.

**Not in step 4.** Attachments, which on the phone need a way to pick a file, and to open one;
scheduled sending; drafts; OAuth; search; the unified inbox.

## What stage 4 found

**The TCP library cannot be used as it is.** `react-native-tcp-socket` was read before it was
used. On Android its TLS does not check the host name: no endpoint identification algorithm and no
host name verifier, and a Java `SSLSocket` checks the certificate chain and nothing about whose
certificate it is unless it is told to. Any certificate a trusted authority signed would be accepted
for any server. A STARTTLS upgrade is worse, because it hands over the IP address of the socket where
the name belongs. So the phone has a transport of its own, a native module of about 200 lines
(`PeregrineTransportModule`) with the check in a function a JVM test can reach (`TlsUpgrade`).
It is tested against a server whose certificate the test trusts and which names one host, so that
what is refused is refused for the name. One test shows the same socket accepting the wrong name
when not told to check, which is the premise of the rest. On the emulator the same server was
accepted under a name in its certificate and refused under an address that is not, with the
handshake ended before any credential was sent, over TLS from the start and after a STARTTLS
upgrade.

**SQLCipher is a build flag, and without it the key does nothing.** op-sqlite takes an
`encryptionKey` in any build and ignores it where SQLCipher was not compiled in, writing the
database in the clear with no error. The flag lives in `apps/mobile/package.json`
(`"op-sqlite": {"sqlcipher": true}`), and `openDatabase` refuses to open at all when `isSQLCipher()`
is false. On the emulator the file begins with random bytes. The passphrase is 32 random bytes
wrapped by an Android Keystore AES key and committed to storage before a database is created with it
(`PeregrineKeystoreModule`). That is the arrangement from the author's other Android apps, and it is
not tied to the screen being unlocked, because a sync has to open the database with nobody there.

**The driver and `SqlDb`.** op-sqlite takes positional parameters only, per its type definitions, so
the adapter refuses a named parameter object instead of binding nothing, and the seven statements
that use names still have to be rewritten. Its transactions are not used. `OpSqliteDb` holds the
connection from `BEGIN IMMEDIATE` to the end under a lock of its own, which gives `SqlDb` the
guarantee that nothing else runs inside a transaction, and is tested against a real SQLite. What
Hermes cannot give is the guard the desktop has against using the outer handle from inside a
transaction, which rests on `AsyncLocalStorage`: there it waits for a lock that is never released.
The repositories use the handle they are given, so it has not mattered yet.

**The repository.** React Native's template expects its packages next to the project. In a
workspace they are installed at the root, so the Gradle plugin, the codegen, the CLI and the Hermes
compiler are looked up there. The last one only showed when a debug build was made to carry its
JavaScript, which a build for the emulator never does, so it was found by trying what the pipeline
would do before the pipeline did it. `npm audit` goes from 8 to 28 findings, all in React Native's build tooling and from two
advisories without a patched version, and none of it is part of the APK.

**Not yet looked at.** What Hermes offers as `TextDecoder`: the prototype reads a message in the
charsets the package decodes itself, and a message in another one would show Latin-1 where it should
show something else. Whether a sync of a real mailbox, with thousands of messages, is workable at
the speed of the base64 bridge. Background work, and anything on a real phone: the emulator is
x86_64, and the debug APK is 62 MB with one architecture.

## To verify before committing to any of this

- Charsets in message headers. UTF-8, ASCII, Latin-1, Latin-9 and Windows-1252 are decoded in the
  package. Anything else goes to `TextDecoder` where the platform has one, and is read as Latin-1
  where it does not. Check what Hermes offers before deciding whether that is enough.
- Whether the key can be handed over in the form `profileCrypto` derives, if a profile is ever to
  move between a phone and a desktop. The phone's own database does not need it.
- Foreground service types and daily caps on the Android version being targeted.
- Hermes and openpgp.js, if PGP is ever wanted.
- nodejs-mobile's actual state, if the shortcut still tempts.

## Effort, honestly

Stages 1 to 3 were estimated at weeks each for somebody who knows this codebase. Stage 1 touched
48 files and took a single working session, so that estimate was too high for it. It stays for
stages 2 and 3 until they are done, because the asynchronous layer was the part with an obvious
shape, and the IMAP client is not. Stages 4 onward are a second application and are measured in
months. This is not a weekend and it is not a quarter.

## The comparison worth making first

Thunderbird for Android, formerly K-9 Mail, does most of the "in" list today. It is GPL, it
handles several accounts, it does IMAP IDLE push, and setting it up takes an evening. Peregrine
already imports Thunderbird's accounts, so the credentials are the same ones.

The reason to build this is the safety work and the way several mailboxes are handled, not the
want of a mail client on a phone. If that reason does not hold up when written out, the plan
above is a great many months for something that already exists.
