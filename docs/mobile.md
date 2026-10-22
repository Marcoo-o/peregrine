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
5. Send, attachments, offline queue, several accounts. **Written, in six steps**: sending, in
   `packages/smtp`, the replay of the offline queue as an engine in `@peregrine/core`, the phone's
   data for several accounts with the queue's storage, the application acting on mail through the
   queue and sending, the unified inbox, and attachments. What is left of the stage is what it
   did not set out to do, see the end of "What stage 5 found so far".
6. Notifications by periodic sync. **Written, and shown on the emulator**: a notification for a
   message that came while the application was closed, and a tap on it that opens the message. What
   it found is under "What stage 6 found".
7. Push as an opt-in, if the platform rules still allow what is wanted by then.

Between 6 and 7 the screens were given the look of the desktop application, made for the phone. What
that is, and what it left out, is under "What the design found".
After that, reading a message was brought closer to the desktop: HTML mail, what is known of the sender and
the links, and the actions of a message. That is under "What reading like the desktop found".
Then the lists: choosing several messages, folders as a tree, and a search. That is under "What the list and the
navigation found".
Last, the phone was set next to the desktop's window, and the frame was brought closer: pictures, a sidebar, a top
bar. That is under "What looking at the desktop's window found".

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

**What this step has not shown.** None of it was run on a real device or against a real provider.
The queue, the actions and the sending are tested on the phone's data and through its adapter, sending
against a scripted server. After step 5 they were also used on an emulator, see there. Two things are known to be
missing or rough. The sending settings of a new account are not tried when it is added, only the
reading ones are, so a wrong SMTP server shows when the first message is sent, as a message that
waits with its reason. A message the server took for some recipients and refused for others counts
as sent, and the refusals are not shown.

**Not in step 4.** Attachments, which on the phone need a way to pick a file, and to open one;
scheduled sending; drafts; OAuth; search.

**The unified inbox.** The point of the project is the inboxes of all accounts in one list, so the
application starts there when there are two or more. The connections stopped belonging to the account
screen that was open: there is one per account, held by the application, made when something asks for
it and forgotten when it ends. That is what lets an action on a message reach the server of the
account the message is in, wherever it is shown, and what lets the list bring every account up to date
at once. A connection that was made to prove a login is kept and not made a second time.

The list is the newest messages of every inbox, merged by date, a message without a date last, 200 of
them, each marked with its account. It is shown at once from what is stored and brought up to date
after: each account is connected, its queue replayed, its folders and its inbox fetched, all at the
same time and each on its own. Replaying comes first so that what the user decided is on the server
before the flags are read back from it. An account that is down, or does not answer within 30 seconds,
is named with the reason under the title, and the rest of the list is the others'. A message opened
from the list goes back to it, and marking, moving and deleting work from there as from a folder.

**On an emulator.** Steps 3 to 5 were used on an Android 36 emulator against a throwaway Dovecot with
two accounts and an SMTP server that writes down what it is given, both on the development machine,
with a certificate of its own that the debug build is told to trust. Two accounts were added through the
form and the unified list showed the six messages of both, merged by date and marked with their
account. A message was opened and answered: the SMTP server received it over STARTTLS and a login, with
the quoted original and the thread headers, and a copy marked read was in the account's Sent folder.
Deleting moved a message to the Trash folder on the server. With the server stopped the status line said
there was no connection, a message that was opened and deleted stayed in the list marked as waiting to
be moved, two actions were counted as waiting, and after the server was back and the list was pulled
down they were carried out in the order they were decided: the read mark first, then the move, and the
message was in the Trash folder on the server, marked read, and gone from the list.

Using it found one mistake that no test had: leaving a message after an action did not show the list
again, because the update that follows a fetch was held back unless the list was already on the screen,
and that held back the way back as well. The server was right and the screen was not. The two cases are
told apart now.

**What this step has not shown.** A real device, a real provider, and anything that takes long: how a
list of several thousand messages behaves, or a connection that drops half way through an action. The
merge, the selection of the inboxes, the connections and the refresh with one account down are tested on
the phone's data with scripted servers. Left out: unread counts, a choice of which accounts are in the
list, search. A message that is already in the list is not removed from it when the server no longer
has it until that inbox is fetched again and, as everywhere on the phone yet, a fetch only looks at the
newest 50, so deletions made elsewhere to older ones are not noticed.

**Not in step 5.** Attachments: a native way to pick a file and to open one.

**Attachments.** Three things had to exist that did not. The structure of a message, its parts and
their headers, moved out of the reader into `mimeParts.ts` with a parameter parser that does what
file names need: quoted values with semicolons and escaped quotes in them, and RFC 2231 for a name
with an umlaut, in one piece or several, in any charset. `listAttachments` walks it and lists what is a
file and not text: a part that says it is an attachment, one that has a name, and one that is not
text by its type, such as an image shown inside the message, which has no name and gets one made
for it. The name is made safe to write to a file system, no path and no leading dots, and the findings
about it are the desktop's, judged by the name the file will be saved under.

The rule for opening a file was written out in the desktop's attachment handler and is one function
in the core now, so that the same file is refused on both: the name is refused on its own because a
script has no signature, and the first bytes are read for a program that is named as something else and
for a file that contradicts its name. Saving has no check, as on the desktop: keeping a file is the
person's decision, and the refusal says that saving is possible.

Picking copies. A file the user chose is copied into a directory of the application's own at once, and
what a queued message refers to is the path of the copy. The queue may run when the application is
started again much later, and by then the permission to read the file that was picked is gone, or the
file. The copies are read when the message is sent and removed only after it has gone out, so a
message the queue has to send again still has them, and removed when the compose screen is left
without sending. What would take a message over 20 megabytes is refused and said, and not left out in
silence. A message that talks of an attachment and has none is held back once, by the desktop's
rule, which ignores quoted lines.

The native module `PeregrineFiles` does five things: pick, read a copy, remove copies, save through the
system's dialog, which needs no access to any storage, and hand a file to another application through
a content address that is good for that one application and that one file, never a path. Every path
JavaScript passes back is held to the one directory the copies are made in, with `..` and links
followed, and the module has JVM tests for that and for the names it makes. Content crosses the bridge
as base64.

**On an emulator.** The two kinds of mail were put into the test account: one with a small file named
`contract.pdf` and one with a program named `invoice.pdf.exe`. Both showed a paperclip in the list. The
first listed its name, type and size and could be saved: the system's dialog offered the name, and the
file on the device was the same bytes. Opening it handed it to the PDF viewer of the system image, which
read it and said that it was not a valid PDF, which it is not, being made up. The program listed two
warnings, that it is a program and that its ending is double, and opening it was refused with the reason
and the way to saving it. Writing a message that said "attached" with nothing attached was held back and
the button changed to "send anyway". A file picked from the system's dialog showed with its size, and
sending it put a message with the file in it, base64 and with its name and type, to the server that
records what it is given, whose bytes decoded to the file. The copy in the application's storage was
there before and gone after, and the copy in the Sent folder was there.

**What this has not shown.** Anything large: a file of many megabytes, which crosses the bridge as one
string and is encoded in JavaScript. More than one file picked at once, though the code takes a list.
A real PDF viewer, an image, a file from a cloud provider whose pick takes time to download. And a
message whose queue run fails with the files already copied: then they stay, as they should, until it
is sent or discarded. The picker reports a CSV as
`text/comma-separated-values`, which is a type that exists and is rarer than `text/csv`; it is sent as
the phone gave it.

**What stage 5 did not set out to do, and is left.** Inline images shown inside a message, a preview of
images, attachments in drafts, drafts at all, OAuth, scheduled sending, search, unread counts, a choice
of which accounts are in the unified list, and the things that only a real device and a real provider
can show.

**How the application is built.** Over stage 5 `App.tsx` grew to a thousand lines that held the state,
the navigation, the connections, the actions on mail and every screen. It is split by what each part
is for, and `App.tsx` is the 63 lines that remain: open the database, build the application, hand the
store to the screens.

- `src/app` is the application without a screen, in plain TypeScript that knows nothing of React. An
  `AppStore` holds what the screens show and tells its listeners when it changes. The services
  (connections, queue, mail actions, files) are made in one place from what the device gives, which is
  the `Platform`. A `Navigator` decides which screen is shown when, a `MessageController` works on the
  open message, a `ComposeController` writes and sends, and an `AccountSetup` adds and removes accounts.
  What the form for an account needs to know is in `accountForm.ts`, apart from the form.
- `src/ui` is the screens, one component per file, with what they share (the styles, the button and
  the chip, the row of a message, the list of attachments, the fields that name a server) apart from
  them. A screen gets its state and what each of its buttons does. One switch chooses the screen for the
  state, and the compiler checks that every kind of state has one.

The point of the split is that the logic can be tested without a screen. It runs in the tests against
a real database and pretend servers, files and a sending server, which the screens could not. That
covers the navigation that had a mistake no test caught, leaving a message after an action not showing
the list again, and the test fails when the old mistake is put back. The behaviour did not change: it was
used again on the emulator after the move, opening a message, deleting it, writing one, attaching a
file and sending it, and the server and the screens showed what they had before.

**Three rough places, cleaned up.** The emulator and the first use had shown three, and stage 6 is not
built on them.

- *Copies of attached files were left behind* by a message that was discarded after it failed too often,
  by an account that was removed with a message waiting in its queue, and by an application that was
  stopped between picking a file and sending. One sweep covers all three: it asks the queue for every
  message there is, those given up on and those scheduled for later included, and has the native module
  remove every copy that none of them refers to. It runs when the application starts, after what failed
  was discarded and after an account was removed. A sweep that fails is logged and stops nothing.
- *Errors about the network were in English*, in several wordings for the same thing, from the platform
  and from the libraries. Now what is certain from how an error is worded is said in German: that the
  connection ended, that the server cannot be reached, that it does not answer, that the encrypted
  connection could not be made. The original text follows in brackets for whoever has to look it up. A
  server's own words are never guessed at.
- *The forms were covered by the keyboard.* The form for an account and the one for writing a message make
  room for it now, and scroll the field that is typed in up to where it can be seen. On the emulator the
  last field of the long form was in view above the keyboard, where it had been under it.

## What stage 6 found

The decision from "Push, and a correction" held: the default is a periodic look on the platform's own
scheduler, and nothing holds a connection open. The look runs as unique periodic work of WorkManager,
which Android runs no sooner than every fifteen minutes and later when the phone lies still or the
battery is low, and only with a network. The settings offer 15, 30 and 60 minutes and 2 and 4 hours, and
say what the floor is. A button looks at once, for whoever wants to see that it works.

- *What counts as new mail* is decided in `src/background`, without the platform. Before the look the
  highest UID of every inbox is noted. After it, a message is new when its UID is higher than that and it
  is not read. An inbox that was not known before, such as that of an account just added, counts for
  nothing, so a new account does not announce everything it holds. The rules of the desktop decide
  whether to say so (`shouldNotify` and its policy in `@peregrine/core`): switched on or off, quiet hours
  across midnight, muted accounts. One message is shown as who wrote and what about, several as a count
  for the account, and either can be left without the preview, which is also what a locked screen shows.
- *The look itself* is the same code that the application uses to refresh its inboxes, run without a
  screen. The scheduler's job starts a task of React Native that JavaScript registered, from the job and
  not from a service, because a service cannot be started from the background on a current phone and a
  job is where that is not refused. It does nothing while the application is on the screen, which looks
  after its own mail, and it never throws: a task that fails logs and ends, and the next time comes anyway.
- *The database is opened once for the whole process*, so the screens and the task share a connection when
  they run together.
- *The settings* are a screen of their own, reached from the accounts, kept in a table that migration 3
  made. The permission for notifications is asked for where they are switched on, not at the first start.
  When it is not given they stay off and the screen says why. The schedule of the platform is made what the
  settings say at every start, so it is right after an update or a reinstall too.
- *A tap on a notification* opens the message from the application's own copy, which the look wrote. The
  native side remembers what was tapped and the application asks for it when it starts and when it comes to
  the front.

Two mistakes were found by using it, and are covered by a test each. A message that came while the
application was in the background was answered with nothing when it was fetched on a connection that had
the mailbox open already, so it showed as no longer on the server and opened fine from the list a moment
later. The connection did not know of messages that came after it opened the mailbox. It is now brought up
to date and asked once more before the answer is believed. And the button to look now went to the same
task as the periodic look, which does nothing while the application is open, so it did nothing. It is
passed on as forced now. A third, found while writing the tests, was an order that came from random ids and
passed by chance: the notifications of an account now come in the order of the accounts.

Shown on an Android 16 emulator: the permission asked for in the settings, the schedule showing up in the
system's list of jobs, a message delivered to the server while the application was in the background, the
notification with sender, subject and account, and the tap opening the message with its text. Not shown, and
not testable there: how a maker's own battery rules treat a job that runs every half hour, which is what is
left of "The rules for foreground services have tightened" for the periodic way too. The quiet hours and the
muted accounts are covered by tests against the logic and were not run on the emulator.

## What the design found

The screens had been plain on purpose, with a colour written into every style. They are now made of the
desktop's tokens (`src/renderer/src/styles.css`): its light and dark palette, its blue accent, the tints for
what is chosen and for what went wrong. `src/ui/theme.ts` has them, `styles.ts` makes the style sheet of
a theme once, and no screen names a colour. The theme is the system's and changes while the application
runs, with the status bar.

- *The colours are measured, not only copied.* `theme.test.ts` checks that every colour that is read on
  another has the 4.5 to 1 that WCAG asks of text, in both themes. One value of the desktop fails: the
  warning yellow is 3.4 to 1 on the light page, which is fine for an icon and not for words. The phone's
  is a darker one, with a comment that says why it differs.
- *What carries over from the desktop's lists:* the account colour as a stripe in front of a message in
  the unified list, subject and sender in bold and the colour of the text while a message is unread, the
  unread count of a folder in a pill of the accent, the folders named by their role. These needed data the
  phone did not have. An account has a colour, given when it is added by the desktop's rule, and migration 4
  gave the accounts that were there one each. The unread counts are counted in SQL.
- *What is made for the phone:* a header with the way back and the title, targets of 48 dp, buttons that
  are filled, outlined or red by what they do, a ring in the accent on the field being typed in, settings
  in groups, and a date as short as it can be: the time for today, the day and month for this year, the
  whole date for older mail. Hover and the density of the desktop's rows are left out: neither means
  anything under a thumb.
- *Left out for now:* icons. The desktop draws them with an icon library, which on the phone is a native
  module more to build and to keep. Text and the colours carry the screens for the time being. The
  accent is fixed to the desktop's blue, where the desktop lets the user choose one of twelve. Both can
  be added on top of what is here without changing it.

Shown on an Android 16 emulator in light and in dark, switching the system's setting while the application
ran: the unified list, the accounts, the folders with their counts, a folder, an open message and the
settings. The list and an open message were also looked at with the system font at 160 percent, where a
layout made of fixed heights would break first: the rows grow with the text and the actions wrap onto
more lines, and nothing is cut off. The forms were not looked at that way.

## What reading like the desktop found

The desktop sanitizes a message's HTML with DOMPurify in its window, which needs a DOM, so it does not carry
over. The phone shows HTML mail in a WebView instead, and what keeps a message from doing anything is not a
sanitizer. It is the policy the page is served under, the one `@peregrine/core/mailCsp` gives the desktop's
reader: no script of the message runs, no form goes anywhere, and no image is fetched from outside until the user
asks. The policy is the first thing in the page, before a byte of the message, and a message cannot unsay it. What
the page builder takes out of the message besides, such as scripts and frames, is tidiness, and is written as that
in the code: it is a pattern over text and nothing relies on it.

- *The application decides every link.* The view refuses every navigation and hands the address to the
  application, which opens it at once when nothing is wrong with it and asks first, with where it leads spelled
  out, when it does not lead where it reads, by the rules of `linkSafety` in the core. Only web addresses and
  telephone numbers are opened at all, and only when they are the address of a link the page has. The page tells
  the application its links and images through one small script of ours, which the policy does not apply to,
  and what it says is read field by field, with lengths cut.
- *What the message has to say for itself* is said above it, in the desktop's order and words: the verdict of the
  server's spam filter, the checks of the sender that failed, a name that claims another address, a reply that
  would go elsewhere, links that do not lead where they read, images that only count the opening, and the images
  that were held back, which one tap shows. The domains a sender or a link is measured against for looking like
  one are those of the user's own addresses.
- *The screen scrolls as one.* The page reports how tall it is and the view is that tall, so the message is not a
  small window in the screen. What can be done to a message is a bar at the bottom, where the thumb is: answer,
  answer everybody, pass on, star, and more, which has marking as unread, moving, archiving, marking as spam and
  deleting. Answering everybody and passing on follow the desktop's rules. Archiving and marking as spam move the
  message through the queue to the folder of that role, and say so when the account has none.
- *Images that belong to the message* are taken out of it by content id and shown as data, up to a size, and are
  not listed under the attachments any more.

Two mistakes were found by trying to get past the checks on the emulator, with messages built for it, and both
are fixed and covered by a test. A link was opened at once, past the check: an address that the view's whitelist
does not match is opened by the view itself with the system's handler, before the application is asked, and the
first version listed only the page's own address there. And sending a form in a message opened its address in the
browser, because the view reports a form that is sent like a link that is followed. The desktop stops a form with
`form-action 'none'`, and the phone's view had not stopped it before it asked the application. A navigation is now
a tap only when it leads to the address of a link of the page.

Shown on the Android 16 emulator, with messages from the test server: a newsletter with a style of its own, an
inline image, a table, a link built to deceive, a counting pixel and an image from outside, held back and then
shown on request, with the dialog for the deceiving link and not opening it; a forged message that has every hint
there is, opened one by one, and put into the spam folder, which the server then had it in; passing a message on,
with its subject and the message under a line that says what it is; and a message with a script, a handler on an
image, a link with a script address, a form and an inline frame, of which nothing ran or opened and where a link
that is only a host did open.

Not done, and not looked at: the attachments of a message are not passed on when it is. Reading mode, printing
and the source of a message are not there, nor the hint for a first message from an address, nor a setting to
confirm every link or to show images always. Addresses in a message that has no HTML are not tappable. The page is
white in the dark theme too, because mail is written for a white page, and that was not looked at in the dark. A
table wider than the screen is cut and does not scroll, as the view does not scroll by itself. Answering everybody
and archiving are covered by tests and were not run on the emulator. The policy comes in a meta element of the
page, which the system's WebView has to honour; it does on the emulator's, and on an old phone that has not updated
its WebView it is the first thing to check.

## What the list and the navigation found

Three things the desktop has that the phone's lists did not: several messages chosen at once, folders as a tree, and
a search. All three are plain TypeScript with tests first, and the screens only show them.

- *Choosing several messages.* A long press chooses the first, a tap then chooses or unchooses more, and the top of
  the list says how many, lets the choice be left and chooses all. At the bottom, where the thumb is: read, unread,
  star, archive, spam and delete. The back button ends the choice before it does anything else. What is chosen is
  grouped by folder and goes through the actions of the queue, as for one message, so the unified list works across
  accounts. Starring a mixed choice stars the rest and does not take stars off, so that a tap does one thing. An
  account with no archive or spam folder is left alone and named in what is said.
- *Folders as a tree.* Folders sit under the ones they are in and can be closed and opened, in the order they are
  used: the inbox, drafts, sent, archive, spam, trash, and then the rest by name. A closed folder shows the unread
  messages of everything under it. Migration 5 keeps where a folder sits, as the server lists it. The delimiter is
  not stored and is read from what is between a folder and its parent in its path, so it works with a slash and with
  a dot. A parent that cannot be chosen, which some servers have only as a place for others, is made up as a name,
  as many levels as are missing.
- *Searching.* The desktop's syntax, from the core: words, `von:`, `betreff:`, `hat:anhang`, `ist:ungelesen`,
  `ist:markiert`, `vor:` and `nach:`. Every word has to be in the subject or in who wrote. It is a search of the
  headers that are on the phone, in every folder of every account, newest first, and each result says its account
  and folder. The phone keeps neither the recipients nor the text of a message, so `an:` is refused with a line that
  says so and the search is made without it, and the text of a message is not searched. What is typed is searched
  for after a pause and the newest search wins, and leaving a message that a search found goes back to the search.

Shown on the Android 16 emulator: two messages chosen and marked read, one archived, each of which the server then
had as it should be; a tree on a server that separates with a dot, with a made up level, closed and opened, with the
count of each folder and the sum when closed; and a search with four results in four folders, opened and left again.

Not done, and not looked at: swiping a message, which wants a gesture library and so a native module, and a preview
of the text in the list, which wants the start of every message fetched and stored. The text of messages is not
searched for the same reason, and there are no saved searches. The folders of all accounts are not folded into one
tree of standard folders as the desktop does. A search cannot be narrowed by account, and its results cannot be
chosen several at a time. Choosing across accounts, starring, spam and delete were run in tests and not on the
emulator, and none of these screens was looked at in the dark.

## What looking at the desktop's window found

The first design worked from the desktop's style sheet and got the colours right. It was still far from the
desktop, which only showed once the desktop was run next to the phone, with the same accounts. What was different
was not the palette but the frame: the desktop has pictures for everything, a sidebar that holds every folder of
every account, a top bar, and a line over the list with filters. The phone had text and glyphs, and three lists
to go through, accounts, folders and messages.

- *Pictures.* The desktop draws its icons with Lucide, so the phone does too, `react-native-svg` underneath, and a
  folder, a role or an action looks the same on both. Each icon is imported by itself: the library has thousands.
- *The sidebar as the way through.* A drawer, which React Native has, from the left edge or from the button of the top
  bar. It has the desktop's content: the folders that are one for all accounts, and every account with its colour,
  whether it is connected, and its folders as a tree with their pictures and counts, where the user is marked.
  The lists of all accounts take a role for this, so inbox, drafts, sent, archive, spam and trash each have a list.
- *The top of a list.* The button for the sidebar, a field for the search, bringing the list up to date and the
  settings; over the list what it is, how many messages it has, and the filters for what is not read, starred or
  has a file. Writing a message is a button over the corner of the list.

Shown on the emulator, light: a folder opened from the sidebar, the top bar and the filters, the drawer with the
accounts and the tree, and the list of sent messages of all accounts from the drawer.

Afterwards, the actions of an open message became the desktop's row of pictures: reply, reply to all, forward,
archive, star, delete and a menu for what is done less often. Seven fit the width of the narrowest phones when they
share it, which is why moving, marking as unread and as spam are behind the last. The list no longer says twice that
it has no messages: the line over it says so, and the list only speaks when the filters have taken away all there are.

The hint for a first message from an address, which the desktop shows, is there too. The desktop keeps a count of
contacts for it; the phone has no such table and asks the messages it has, since the sender of each is stored with
it: a message is a first one when it is the only one from its address, itself included. That is a weaker statement
than the desktop's, which has seen all the mail that ever came, so the phone's words say "among the messages on this
device" and not "never before". It is shown as information, below the links and the counting pixels, not as a warning.

Looked at on the emulator, in light and in dark: the open message with its hints and the row of pictures (all seven in
view, the star filled in the warning colour once set), the list of a folder with its filters and the corner button, the
sidebar, and the list of folders of an account. The dark theme held up in all of them; the page of a message stays
white in both, as the sender made it.

The list of accounts has the top bar of the other lists now, so the sidebar, the search and the settings are one tap
away from it, and the three buttons that led to them are gone. A large system font (1.6) was tried on the form for an
account: it holds, only the example in the first field is cut off.

Two things the emulator showed that had nothing to do with looks, both fixed:

- *Removing an account was one tap.* The button sat under "new message" on the screen of an account, and a tap on it
  deleted the account with every message stored for it and what waited in the queue, without a question. It asks now,
  and says what goes and that the mail server is not touched. Found by tapping where the other button had been.
- *The back key left the application from every screen*, except while messages were chosen. It does what the way back
  of the screen does now (`app/backAction.ts`): the sidebar is put away first, an open message goes back to its list,
  and the lists where the application starts leave it, as the key does everywhere. The form for the first account has
  no way back, so the key leaves from it. Writing a message asks before it throws away what was changed, whether
  the button or the key was used, since the key is easier to hit by mistake than the button. All of it was seen on the
  emulator afterwards: the question for removing an account, the key on an open message going back to its list with the
  application still there, a draft that was not touched being left at once, and one with a word in the subject asking.

The list of folders of an account got the same frame as the others: the top bar, the account's colour and name as the
title, the corner button for a new message, and "Konto entfernen" as a quiet red line at the end of the list, away from
what is opened and written every day. Its way back is the sidebar and the key, so the link "Konten" is gone from it.

Not done: swiping, a preview of the text, tags, snoozing and the filter rules of the desktop do not exist on the phone.

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
