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

Out, for now (much of it has been done since: snooze, tags, drafts, OpenPGP; what is still out is in "What is still missing next to
the desktop"):

- Filter rules, tasks, saved searches, several identities per account.
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
saying why, what the phone cannot do yet and would otherwise do wrongly: a later time (attachments and, later,
encrypting and signing are done). An answer quotes the original and joins its thread, which needed the
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

## What drafts found

Giving up a written message used to lose it. The desktop keeps drafts on the server, in the Drafts folder, marked
`\Draft`, and replaces the old revision with the new one on each save. The phone does the same, so a draft started on
one is there on the other.

- *Leaving a changed message asks three things:* write on, keep it as a draft, or throw it away. Write on is the filled
  button, because it is the one that does no harm to a tap meant for something else. An unchanged message is left at
  once, as before.
- *Saving goes to the server at once and not through the queue.* Everything else that changes mail waits in the queue so
  that decisions reach the server in the order they were made. A new message in the Drafts folder does not compete
  with any of them, and the queue's kinds are shared with the desktop, so a new kind would have changed the desktop.
  The price is that saving needs a connection. Without one the screen stays, says why, and the message is still
  there to send or to give up: a draft that is only half kept is worse than one that was not kept.
- *A revision replaces the one before it the way the desktop does it:* the new one is appended first and the old one is
  deleted after, and the deletion goes through the queue, which already knows how to delete for good. A failure in
  between leaves two drafts and not none.
- *Sending a draft deletes the draft;* what giving up one does is changed by "What keeping drafts by itself found".
- *Which drafts can be written on.* A draft is opened only when saving it again would keep all of it. One with attached
  files is not (the phone would write a new copy without them), nor one with a formatted text (it writes plain text), nor one
  with recipients in `Bcc` (it has no such field). The reason is said on the message. Saving a new message with
  attached files is fine: they go to the server with it.
- *Own messages are no first contact.* The hint "Erste Nachricht von dieser Adresse" showed on a draft because
  nothing else is from the sender, who is the user. It is left out for any of the user's own addresses.

Seen on the emulator: a new message saved as a draft (flags `\Draft` and `\Seen`, the headers and the text as
written), the draft opened from the Drafts folder, written on and saved again, with exactly one draft left on the server.
Sending a draft and the failure without a connection are covered by tests and were not tried on the device.

Not done: drafts while offline, saving as the user writes, a `Bcc` field, formatted drafts, and writing
on a draft with attached files. (Several of these were done later; see the sections that follow.)

## What suggesting recipients found

Writing a message meant typing every address in full. While one is typed in "An" or "Kopie", the people that match are
shown under the field, up to four, and a tap puts the name and address in and leaves the field ready for the next one.

- *The phone knows people only as senders.* It keeps who a message is from and not who it was to, so the suggestions are
  the senders of the messages it has, in every folder of every account. The desktop keeps a table of contacts, filled
  from what it sends too; the phone has none and does not need one for this, as for the first message from an address
  (see "What reading like the desktop found"). People written to but never heard from are not suggested. Keeping the
  recipients would be a change of the database and of what a sync fetches, and is left for when it is wanted.
- *Order:* the ones that sent most first, then the latest. One person is one address, whatever its spelling and
  however many names it was written with: the name used most is shown, and the messages of every spelling are counted.
- *Left out:* the user's own addresses, and an address that has been typed in full already, which has nothing to add.
- *What is typed* is what follows the last comma or semicolon. A suggestion takes its place and ends with a comma, so
  the next typing starts after it and what is in front is not touched. A name with a comma in it is written in quotes.
- The search is `instr` on the lower case text and not a pattern, so that nothing typed means anything but itself, as in
  the search of the lists.

Seen on the emulator: two suggestions chosen one after the other, the first address still in the field after the second.
That the suggestions of two accounts are one list, that the user's own address is not among them and what a name with
a comma is written as are covered by tests.

Not done: people written to, the tab or the keyboard's own way of choosing, and suggestions for the field of an
account other than the one that is written from (all accounts' senders are suggested for any).

## What the text of messages found

The list and the search of "What the list and the navigation found" had only headers: the phone fetches the envelope of
a message, and the text only when the message is opened. That left the desktop's line of text under every subject
missing, and a search that could not find a word that was only in a message. Both need the text, so the phone keeps it.

- *The text is fetched after the lists, not before them.* A list is shown at once from what is stored and brought up to
  date; then the next 25 messages of that folder that have no text are fetched, newest first, one trip each, and the
  list is shown again with the lines that came in. It is done for the folder of a list of one account and for the
  folder of the role of a unified list, and not in the background while the application is shut: that would spend a
  battery on mail nobody has looked at. A folder that has not been looked at is worked through 25 at a time.
- *Opening a message keeps its text at no cost,* since it is fetched for reading anyway.
- *What is kept:* the text without the HTML, up to 20,000 characters, with one kind of line end, for the search; and
  the first 160 characters of what the message says itself, flattened to one line, for the list. Lines that quote an
  earlier message are left out of the second, since they are not what this one says. Two lines are shown, so that a long
  one is cut by the screen and not by a count.
- *Large messages are not fetched for a line.* The whole of a message is fetched, attachments with it, so a message of
  more than 512 KiB is left out and stored with an empty text, and gets its line and its place in the search when it
  is opened, which fetches it anyway. Twenty-five messages of that size over mobile data would cost more than the
  lines are worth.
- *Messages that fail are not tried again.* One the server no longer has, and one that cannot be read, are stored with an
  empty text, which is a text and not "not fetched yet" (the columns are null until then). A broken connection stops
  the run, keeps what it did and leaves the rest for the next visit. A folder is fetched one run at a time, so a list
  that is brought up to date twice in a row does not fetch twice.
- *Search* now takes every word in the subject, in who wrote or in the text, in any case, with `%` and `_` meaning
  themselves as before. `betreff:` and `von:` stay for those fields. A message whose text has not come yet is found by
  its headers, and the help line says "in the text of the messages that are loaded already".
- *A switch for the line,* as the desktop has one: "Text unter dem Betreff zeigen" in the settings, on by default,
  under "Listen". It matters to somebody who does not want a stranger to read the first of their mail over their
  shoulder. The setting is its own group in the settings table, and the lists carry it in their state, read
  together with the list before the screen is looked at: reading it after made a list that the user had already left
  come back, which a test of the search found.
- The migration adds the two columns (`body_text`, `preview_text`) to the messages that are there, with null in them.

Seen on the emulator: the five messages of the inbox without a line, then each with one after the folder was opened, and
a search for a word that is only in the text finding the one message with the line under its subject. The run that stops
on a failed connection and the migration of a database with messages are covered by tests only.

Not done: fetching in the background; the text of attachments; and a fetch of
only the start of a message, which would reach the large ones too (the whole of each message is fetched now, and a partial
fetch of a MIME part would need a new call in the protocol layer).

## What organising the lists found

A message could be archived or deleted only by opening it or by choosing it with a long press, and the tags that the
desktop sets, which are keywords on the server, could not be seen or set. Two things for the lists.

**Swiping.** A message in a list of a folder or of all accounts is swiped to the right to archive it and to the left to
delete it, as the green and the red that come out from under the row say. It goes through the same actions as the choice
of several messages, so the queue, the notice for an account without an archive and the list shown again are the same.

- A swipe begins after 12 dp sideways and only when the touch is clearly more sideways than up or down, and it
  takes the touch from the list then and not before, so scrolling is never in the way. Letting go after more than a third
  of the width does it; short of that the row springs back. These decisions are plain functions with tests (`swipe.ts`).
- It is off while messages are being chosen, where a tap is a choice.
- Nobody can swipe with a screen reader or a keyboard, so the row offers the same two things as accessibility actions.
- There is no "undo". Both moves can be undone by moving the message back, and the queue shows what waits, but a snack bar
  that takes it back is the next thing to want. The search results are not swipeable: after an action they would have to
  be searched again, which the controller of the lists does not do.

**Tags.** The desktop's tags are IMAP keywords, so a tag set on the phone is on the server for the webmail and the desktop,
and the other way round. The phone keeps only what a keyword is called and how it looks.

- A table of tags (migration 7: name, keyword, colour, order) as the desktop has it. The keyword is made from the name
  by the desktop's own function (`keywordFor`), "Für später" becoming `Fuer_spaeter`, since a keyword that the server
  does not take is a tag that does not stick. A name that comes to a keyword that exists is that tag, in any case.
- The tags a message has are its keywords that are tags (`isTagKeyword` of the core, so `\Seen` or `$Junk` are not),
  shown as small marks in their colour under the subject in every list (three, then "+n"), and all of them on the
  message. A keyword that nobody made a tag of, set by another client, is shown by what it is, in grey.
- Setting a tag is `setFlags`, like a star, through the queue: on one open message from "Mehr" and on several
  chosen messages from the bar, where the sheet shows for each tag whether none, some or all of the chosen have it and a
  tap sets it on all, or takes it off when all have it. A new tag is made and set in one step.
- The tags are read into the store when the application starts and are given to the screens by a context, so a list does
  not read them, and a tag made while choosing is in the lists at once.

Two things came up on the way. The sheets from the bottom (the menu of a message and the tags) reached under the buttons
of the system, which cut off their last line; they are raised by the height of those now. And the sheet for choosing
tags is the first that has a text field, so it moves up with the keyboard.

Seen on the emulator: a tag made and set from a message ("Wichtig", with the keyword `Wichtig` on the server next to
`\Seen`), its mark in the list; a message swiped to the right, which was in the archive of the server after, one swiped
to the left, which was in the trash, and a short swipe that did nothing. The tagging of several chosen messages in a list
of all accounts, and what a keyword made by another client looks like, are covered by tests only.

Not done: renaming, recolouring and deleting tags, filtering a list by a tag (the search has no `tag:` yet, nor does the
core's parser), tags in the sidebar, snoozing, and an undo for a swipe.

## What putting aside and filtering found

Three things, of which the first came from looking at the swipe on the emulator.

**The boxes of a swipe grow with it.** They were two halves that stood behind every row all the time, and a row that
was moved showed one of them fixed in place. Now each side is as wide as the row has been moved to it, so there is nothing
behind a row at rest; its picture comes in after the first 24 dp and grows when the swipe is far enough to count.
The word under the picture keeps its own width, so a box that has only just come out is cut and does not squeeze it.
Seen by holding the touch part of the way with `input motionevent`, to both sides.

**Filtering by a tag.** The chips under the title of a list are scrollable now, and after "Ungelesen", "Markiert" and
"Anhänge" there is one for each tag, with its colour. One tag at a time: a second tap on the same one lets it go, a tap on
another replaces it. It narrows the list like the other filters. There is no `tag:` in the search, because the core's
parser has none.

**Putting messages aside,** as the desktop's "Später erinnern…": a message is gone from the lists until its moment and is
back after it.

- It is the phone's own, as on the desktop (`snoozed_until`, migration 8, written nowhere else), and says so under the
  choice: "Gilt nur hier: auf anderen Geräten bleibt die Nachricht im Posteingang". Nothing is told to the server, so it
  does not go through the queue.
- A moment that has passed is no snooze at all, so no list needs anything cleared when it comes: the lists compare it
  with the clock. A folder's list, the lists of all accounts and the unread counts leave the messages that are away out.
  What is done to a message that is open finds it all the same (`getMessage`).
- The presets are the core's (`snoozeChoices`): later today, this evening, tomorrow morning, the weekend, next week,
  only those that are worth offering at this hour, in the order of their time, with the time they come to. Their
  names are the desktop's. A time of one's own is not offered: it needs a picker for the date and the time.
- *Where:* "Mehr" of an open message (and "Jetzt zurückholen" for one that is away), and the bar of several chosen
  messages. A list of its own, "Wiedervorlage", is in the sidebar with the others, with how many are away, and each
  message in it says "Zurück am Fr., 23. Okt., 08:00"; in that list the bar brings messages back instead.
- *The reminder.* The periodic look for mail (see stage 6) also looks at what has come due, and tells it as "Nachricht
  ist wieder da" or "N Nachrichten sind wieder da" for an account, with who wrote and what about for one, under the
  heading "Wiedervorlage für account" (a dot between the two was used at first and is not any more). Each is told once: the moment is taken off what was told. It goes by the same rules
  as new mail (switched on, account not muted, not in the quiet hours), and it comes at the next run after the moment,
  which is up to the interval the user chose later: the platform has no exact alarm to give here. While the application is
  open the message is simply in the list again.

Seen on the emulator: a message put aside until tomorrow morning from "Mehr", gone from the inbox, in "Wiedervorlage" with
its line and its tag, and the tag filter in that list. The reminder, the lists of several accounts and the unread counts
are covered by tests only.

Not done: a time of one's own, bringing a message that comes back to the top, filtering by a tag in the search, and tags of
other clients as filters (only the tags the user made are offered).

## What managing tags and the blind copy found

**Managing tags.** Tags could be made and set, and now they can be changed and forgotten, in "Einstellungen" under
"Tags verwalten", as the desktop's settings have them. A tag is a row of a list: its colour, its name, and under the
name its keyword. A tap opens a sheet to change the name and the colour, with a button to delete; "Neuer Tag" makes one.

- *Renaming and recolouring leave the keyword as it was,* as on the desktop. It is what the messages carry on the server;
  a new one would leave the tag on none of them. The sheet says so under the name.
- *Forgetting a tag forgets only its definition.* The keyword stays on the messages that have it, and they show it
  by what it is, in grey, as they do for a tag another client made. The dialog says that. Taking it off every message
  would mean rewriting mail this phone has not all fetched, and another client may use the keyword under its own name.
  A tag made again with the same name is the same keyword, and its messages are its again.
- A name that is nothing is not a name: the button is off for it, and the controller refuses it as well.
- The twelve colours are one component now (`TagColors`), used by the sheet that sets tags and by this one.
- Where the phone differs from the desktop: a name that comes to the keyword of a tag there is gives that tag back,
  where the desktop makes a second tag with a suffix (`_2`). Typing "für später" for the tag "Für später" is the same tag.

**The blind copy.** The compose screen has a "Bcc (verdeckt)" field after "Kopie", with the suggestions of the other
two, and a message can go to nobody but a blind copy.

- *A message that is sent never has the header,* and the address is only in the envelope: that is the point of a
  blind copy, and a test looks for the address in what the recipient gets. This was true before and is checked now.
- *A draft is the one place that has to keep it,* since it is all the draft can remember who it was for. The core's
  `composeMessage` had no way to write the header, so it has an option `draft`, and only a draft writes `Bcc`. The saved
  draft of the emulator has `Bcc: secret@example.net`, and the draft of a message to nobody has no `To`.
- *Drafts with a blind copy can be written on again.* They were refused before ("verdeckte Empfänger"), because saving
  them again would have lost it. The message that is read has its `bcc` now, from that header, with the names decoded.
- Leaving a message with only a blind copy typed asks, like any other change.

Seen on the emulator: a tag renamed and recoloured with its keyword unchanged, the Bcc field and a draft saved with the
header on the server, and the buttons of the dialog for leaving a message by weight. Forgetting a tag, writing on a draft with
a blind copy and sending one are covered by tests only.

Not done: ordering the tags, the number of messages of a tag, deleting the keyword from the messages, a tag in the search.

## What keeping drafts by itself found

A message that is written was lost if the application was closed, or the battery ran out, before it was kept by hand. It
is kept by itself now, as the desktop does it: once writing has paused for four seconds, in the Drafts folder, in place
of the revision kept before, with a line under "Von" that says "Entwurf gespeichert um 14:03", or that it is being kept, or
why it could not be.

- *Appended first, deleted after,* as for a draft kept by hand: the new revision is on the server before the old one goes,
  and the deletion is the queue's. The UID the server gives the draft is what the next revision replaces. A server
  that does not say (no UIDPLUS) would get a second draft at every pause, so keeping by itself stops after the first and
  the line says it was kept; keeping by hand still works.
- *Nothing is kept for a message that is as it was.* The decision is a plain function (`autosaveDue`): not while the
  message is being sent or kept by hand, not when it is as it was when it began or when it was last kept.
- *When it cannot,* because the account has no folder for drafts, the line says so and the message is written on; the next
  pause tries again. Without a connection the draft waits in the queue, see "What keeping drafts without a connection found".
- *One thing at a time.* Keeping, sending, keeping by hand and throwing away are done one after the other, and the last
  three wait for one that is running and then take the newest revision's place, so that a draft is never left behind by
  a send that did not know of it. What finishes after the user has left is put on no other screen: every writing of a
  message has its own `session`.
- *Leaving.* When all that was written is kept, "Abbrechen" and the back key leave without a question and leave the draft
  where it is. When something is written that is not kept, the question of the three answers is still asked.
- *Throwing away deletes the draft,* as the desktop does ("Verwerfen"): the draft kept of the message, by hand or by
  itself, is removed too, and does not turn up as the draft of a message that nobody wants. For a draft that was opened and
  thrown away this is a change from before, when the original was left: with a revision kept by itself there is no original
  to leave. A message that was never kept has nothing to delete.
- Where a message goes after it was sent, kept by hand or left is where it began, or the Drafts folder when it came from
  one (`fromDraft`), as before; the draft kept by itself does not change that.

The first time on the emulator it showed a real mistake: a draft with nobody to go to, which is how a draft begins when
the subject comes first, was refused with "There is no recipient", because `composeMessage` wants a recipient. A draft needs none
now (a message that is sent still does), with tests in the smtp package and for saving.

Seen on the emulator: a subject typed, "Entwurf gespeichert um 00:09" four seconds after, the draft on the server; typing on
replaced it (the old UID gone, one draft left); "Abbrechen" left without a question and the draft stayed. Throwing a message
away, sending after keeping, a failed connection, and the server that gives no UID are covered by tests only.

Not done: keeping while the application is in the background or being closed (it waits for a pause in writing and does
not run when there is none).

## What keeping drafts without a connection found

A draft needed a connection, because it was appended to the server directly: by hand it stayed on the screen with
"nicht erreichbar", by itself it said that it could not. It goes through the queue now, as everything else that is decided
does, so a message written in a train is kept when the train has a signal.

- *A new kind of queued action,* `saveDraft`, in `@peregrine/core` (the desktop's queue is the same code and does not use it
  yet). It carries the message as it is written, a `draftKey` that says which writing of a message it is of, and the
  revision it replaces. The phone registers what keeps it (`keepQueuedDraft`: append first, delete the old revision after,
  from the server and from the phone's own copy) the way it registers the sender, and a queue without that handler lets
  the draft wait and does not drop it as if there were nothing to do.
- *Once per writing of a message.* A newer revision takes the place of one that still waits (`dropQueuedDraftSaves`) and
  inherits the revision it was to replace, so a message changed ten times offline is kept once, as it was last, and the
  old revision on the server is deleted once.
- *A connection is made when there is none,* as before, and only a connection that cannot be made leaves the draft
  in the queue. The line then says "Entwurf wartet auf eine Verbindung"; when the queue has run, the screen is told
  where the draft is (`onDraftKept`), and the line says when it was kept. Keeping by hand without a connection leaves
  the screen at once, the draft behind it in the queue.
- *Files travel with it.* Attached files are copies the phone made; a draft that waits carries them, so they are neither
  removed when the screen is left nor swept (`referencedCopies` counts `saveDraft` as it counts `send`) until the draft
  is kept.
- *Sending or throwing away the message takes the waiting draft out,* before it can be kept as the draft of a message that
  nobody wants. The queue runs in order, so a draft kept earlier than the send of the same message is a case the send's
  own deletion of the kept revision covers.
- *An attempt that fails with a connection* (the server refuses, a timeout) is the queue's failure like any other: counted,
  retried at the next connection, given up after the limit and then reported. By hand the screen stays with the reason; the
  action stays queued and is replaced by the next revision or taken out by throwing the message away.

Seen on the emulator: with the server stopped (an open connection survives taking away the port forwarding, so the server
itself had to go), changing the subject showed "Entwurf wartet auf eine Verbindung". With the server back the line stayed
as it was: the phone makes a connection again only when something asks for one (opening an account or a folder, the next
keeping), there is no timer, which is as true for a message that waits to be sent. The next pause in writing connected,
kept the draft, and the server then held one draft (the latest revision) and not the first one. Not seen: files attached to
a draft that waits, sending or throwing away a message with a draft that waits, and the draft being kept after the screen was left.

## What connecting again and the smaller gaps found

What was decided without a connection waited until the user opened an account or a folder: nothing else made a
connection come up. That was true of messages and changes since the queue exists, and became plain with drafts, which
wait as well now.

- *Connecting again by itself* (`Reconnector`, in `src/app`). It looks for the accounts that have something waiting in the
  queue and no connection, connects them and runs their queue (`connectAndRun`). It is started by what could leave
  something waiting: a change put into the queue, and a connection that ended. A try that fails is repeated after
  5, 15, 45 seconds, 2 and 5 minutes, and from then on every 5; one that works, or a queue with nothing in it, ends it.
  An account that nothing waits for is not kept connected, as before: the battery is not for that.
- *Coming to the front tries at once* (`Application.comeToFront`, called by the app state change) and from the shortest
  pause again. It also opens the message of a notification that was tapped, as before.
- *No timer outlives the application.* `stop()` removes it, and a stopped reconnector ignores what asks it later, which
  includes the connections being let go of by `stop()` itself.
- *Not done:* a wrong password is tried again every five minutes for as long as something waits for that account. A refusal
  that no waiting helps (authentication) could be told apart and given up on, and has not been.
- *`tag:` in the search* (`searchTags.ts`). The syntax of the search is shared with the desktop's, whose parser would take
  `tag:x` away from the words and then not look for it. So the phone reads the tags out of the text first and gives the
  rest to the shared parser. `tag:Rechnungen`, `tag:"Für später"`, several of them, together with every other term; by the
  name the user gave, or by the keyword, in any case; a keyword that another client set and the user made no tag of is
  found as well. The help line of the search says so.
- *The tags with how many messages have each, and in an order of one's own.* The list of tags says "12 Nachrichten" under a
  tag (the messages that are stored on the phone, which is what the filter and the search look through as well) and the
  editor has "Weiter nach oben / unten", which numbers the places again from the first. The lists and sheets that show tags
  show them in that order.
- *A moment of one's own to put a message aside until* (`CustomSnooze`, `snoozeCustom.ts`): a day of the next two weeks
  as chips and a time as it is typed (`8`, `8:30`, `14.15`, `0830`), said in words as it is typed, and not offered when it
  is not ahead of now. There is no date picker: it needs a native module, and the presets are what is used. The first
  offer is the next full hour, or the morning of tomorrow late in the evening.
- *The status line names drafts that wait* ("1 Entwurf wartet", "3 Aktionen warten, davon 1 Entwurf"). The Drafts folder
  does not show them as rows: a row of the list would be a message that is not on the server, and every action of a row
  (swipe, choose, move) would have to know of it.
- *A mistake that was found on the way:* the status line took the actions that were given up on from the ones that wait,
  though the store counts them apart, so three waiting and one given up said two. Fixed, with a test against the
  real summary.

Seen on the emulator: with the server stopped, a message opened offline put a change into the queue ("Keine Verbindung ·
1 Aktion wartet"); with the server started again and the phone left alone, the line went away and the server had a
session of the phone a short while later. The change itself could not be seen on the server, since the messages the phone
had stored were from an older state of the demo server. `tag:dringend` found the one message with that tag, and
"Eigener Zeitpunkt …" in the sheet showed the days, the time ("11:00", the next full hour) and "Zurück am Fr., 23. Okt.,
11:00"; with tomorrow chosen and "Erinnern" the message left the list. Covered by tests only: the order and the counts of
the tags on their screen, a time that is no time or past, "tomorrow morning" when it is late in the evening, and the
status line for drafts.

## What push found

New mail reached the phone at the next run of the platform's schedule, at best every 15 minutes. It reaches it at once now, on
a device that has a push service, and as before on one that has not.

- *The phone does not keep a connection open itself, and no server of ours does.* A device may have a push service of the
  system for it: a service that keeps IMAP IDLE open for every application that registered a source, and wakes the application
  when the server says that something happened. The application finds out whether there is one by asking the package manager,
  and talks to it by broadcasts (the action names are in `SystemPush.kt` and the manifest). The phone talks to the mail server
  only. Where the device has no such service, `available()` is false, nothing is sent, and the schedule is all there is.
- *What the application does* (`background/push.ts`, `PeregrinePushModule`, `SystemPush.kt`): it registers the inbox of every
  account that notifications are on for and that is not muted (login data included, which the service keeps sealed in its own
  store), takes an account out when it is muted, when it is removed, and all of them when notifications go off. `applyPush` is
  idempotent and runs at every start and after each of those changes; a registration that is the same again changes nothing
  in the service. An account whose connection is not encrypted is not registered.
- *The wake* (`PushWakeReceiver`) starts the look for mail that the scheduler starts, with the same force and the same
  notifications (`SyncScheduler.runForPush`: expedited from Android 12, and put behind a look that is under way instead of
  dropped, since that one may have fetched before the message came). Quiet hours and muting decide what is shown, as before.
  The receiver is protected by a permission only the service holds, and where there is no service the permission is not defined
  and nobody can wake it. The schedule stays as the fallback.
- *What was found on the way to making it work:* the system names the sender of a broadcast only when the sender shares its
  identity (`BroadcastOptions.setShareIdentityEnabled`), so a registration without it is ignored by the service; a service can see
  only the applications it is told of, so the receiver declares an intent filter for the wake action; a service that was just
  installed is stopped and needs `FLAG_INCLUDE_STOPPED_PACKAGES` to get its first registration. All three are in the design
  document of the service.
- *A line is written for each look* (`the look for new mail: {"synced":1,"failed":0,"notified":1}`), since the first two wakes
  of the first test on the emulator led to no notification and nothing said why. They have not been seen since.

Seen on the emulator, with a push service installed next to the application, against the test Dovecot: the account
registers at the start and the service shows it as `idle`; a message delivered with the application in the background was
notified within about a second of the delivery, three times, and once with the application's process ended (about two seconds);
after the server was stopped and started again the service connected again by itself and woke once. Covered by tests only:
registering, taking out and muting, an account without encryption, a service that does not answer, the order of the settings
and the registration. Not seen: a device that has no service (the receiver and the queries are inert, as designed), Doze, the
service as a part of the system, and more than one application using it.

Not done here: a foreground service with IDLE inside Peregrine for devices without a push service, which was the first plan (see
"What the foreground service found"). Android before 14 is treated as having no system service, since the sender is not named there.

## What the launcher icon found

The phone app had the icon of the template. It has the falcon of the desktop's icon now, as the phone is the desktop's
application made for the phone.

- *One drawing, made for every use.* The falcon is the one of `resources/icon.svg`, unchanged, on the same violet gradient.
  The sources are two SVG layers in `apps/mobile/android/icon/` (`foreground.svg`, `monochrome.svg`) and `npm run icon:android`
  makes everything from them (Chromium by way of Electron, as `npm run icon` does for the desktop): the three vector drawables
  of the adaptive icon and the two XML files that put them together, and the PNGs for Android 7, which has no adaptive icons
  (a rounded square and a circle, five sizes each). The vector drawables are made from the SVG layers and not drawn a second
  time, so that the two cannot drift apart. `--preview=<folder>` also writes how the icon looks under a circle and a square
  mask.
- *Sized for the mask.* An adaptive icon is 108 units of which a launcher shows the middle 72 and keeps the middle 66 safe.
  The falcon first filled nearly all of it and sat high, with the beak near the edge of the circle; it is 16 percent smaller
  and centred, which leaves air all round.
- *The monochrome layer* (the themed icon of Android 13 and later: the system colours it and uses only its shape) is the
  falcon in one colour: the eye is a hole in the body, the dark feathers and the beak are filled. The dark feathers reach beyond
  the body, so making them a hole as well (the first try, with the even-odd rule) cut the silhouette in two.
- The small icon of the notifications is the envelope as before: it has to be one colour and small, and the falcon is
  neither at 24 pixels (the desktop's own icon drops the eye and the stripe below 32 for the same reason).

Seen: the rendered layers under both masks and in one colour, and the resources compile (`processDebugResources`), and the
release APK has the adaptive icon as its icon. Not seen on a device: the launcher, the dock, the themed icon.

## What the foreground service found

On a device without a push service of the system, new mail still reached the phone at the next run of the schedule, every 15
minutes at best. There is a switch now that has the application keep the connections itself.

- *Off until the user turns it on.* "Sofort benachrichtigen: Verbindung offen halten" is in the settings, under the switches for
  notifications, and only where the system has no push service (where it has one, the switch is not there and the service is
  used). It costs some battery and shows a notification for as long as it is on, and the text under it says so. It does nothing
  while notifications are off: what it watches is what the settings say, so the accounts that are muted are not watched.
- *The same registrations.* JavaScript says to the same native module what to watch (`register`, `unregister`,
  `unregisterAll`), and `PushRouter` sends it to the system service where there is one, to the foreground service where there is
  none and the user asked, and nowhere else. Nothing that follows a wake is written twice: the look for mail and the
  notifications are the ones of the schedule and the system service.
- *`IdleService`* is a foreground service of the type special use (nothing else fits a connection that waits for mail, and the
  other types are ended by the system after hours on Android 15), with a quiet notification that opens the application. One
  watcher thread for each account (`IdleWatchers`, `IdleSession`: the same design as the push service of the system: EXAMINE and
  not SELECT, a change that comes while IDLE ends is not lost, the exists count of the open is no change, a refused login is
  tried again only after 30 minutes and a network that comes back does not cut that short, pauses of 5 s to 5 min after a failed
  connection). IDLE is begun again every ten minutes and not every 25: a mobile network forgets a quiet connection sooner. A
  change goes through a gate (`WakeGate`) that lets one look start per ten seconds and keeps one for the end of the gap.
- *It survives the system ending it.* The sources are in a file (`IdleSourceStore`) with the passwords sealed under a key of the
  Android Keystore, since nothing else holds them when the system has killed the process; `START_STICKY` has the system start the
  service again, and a receiver starts it after the phone was started or the application updated (`IdleBootReceiver`). Switching
  the connection off, or notifications off, ends the service and deletes the file: nothing that holds a password is left.
- *The battery:* a foreground service does not keep a phone out of Doze, and the system may close its connection while it rests.
  The setting offers a button to the system's list of the applications that are free of those limits.
- *A debug build next to another one:* `-PdevSuffix=.dev` gives the debug build another application id, so that it can be
  installed next to another build of the application.

Seen on the emulator, where the system has no push service: the new section is in the settings,
switching it on starts the foreground service (type special use, the notification of the channel for the connection), "watching 1
inboxes", and a message delivered with the application in the background was notified two seconds later. With the process
killed hard the system started the service again within two seconds, which read its source from the sealed file and watched
again, and the next message was notified three seconds after its delivery. Switching it off ended the service and removed the
file. Covered by tests only: the session and the watchers against a server of the tests (32 JVM tests), the settings and the
registrations that follow them. Not seen: the start after a reboot, Doze, STARTTLS against a real server, the button for the
battery settings, and a phone with Android before 8.

## What attachments in drafts and in a message passed on found

A draft that had attached files could not be written on again: it was refused, since saving it would have dropped them from the
copy on the server. A message that was passed on carried only the text of the original, as the desktop's does.

- *The files of a message become files of the phone* (`bringAttachments`, in `draftAttachments.ts`). Each attachment of the open
  message is copied into the application's storage as a picked file is (`Files.stash`, native `stash`, the same directory as the
  picked ones) and attached like one, under the same limit for the message as a whole (`attachPicked`). What does not fit is
  refused and its copy removed; what has no readable content is said. If copying one fails, the copies made so far are removed
  and the failure is shown.
- *A draft is opened with its files.* `startFromDraft` takes them over before it opens the compose screen. If not all can be
  taken over, the draft is not opened and the copies made are removed, with the reason on the message: writing on it would
  lose the rest from the server's copy. The draft that is opened counts the files as part of what was kept, so opening it and
  leaving it is not a change. Saving it again by hand or by itself keeps them, as for any message with files. A formatted
  text is still refused.
- *Passing a message on carries its attachments*, each of which can be taken off before sending, like any attached file. This is
  more than the desktop does (it carries the quoted text only), and it is what most people expect of passing a message on. What
  cannot be carried (too large for a message, or not readable) is said in the line over the message.
- Both starts are asynchronous now, since the files are copied first, which takes a moment for large ones.

Seen on the emulator: a message with a PDF passed on shows the file on the new message, with "Entfernen"; typing keeps it as a
draft by itself, which the server has as a multipart message; opening that draft and "Weiterschreiben" shows the file again; a
change replaces the draft on the server with one that still has it. Covered by tests only: the limit, files without content,
a failing copy and the clean-up of the copies, for both starts.

## What OpenPGP found

The phone could not write an encrypted or signed message, and showed one that came in as what it was on the wire. The question
that had been left open was whether OpenPGP runs on Hermes at all, and where a private key lives.

**Does it run.** Yes, with OpenPGP.js 6 and no native module for it, with four things put under it (`src/pgp/runtime.ts`,
`src/pgp/openpgp.ts`, `metro.config.js`):

- *The build.* Metro takes the Node build of the package, which is no use here. The package is aliased to its browser build
  as an ES module (`openpgp.min.mjs`); the UMD file is an IIFE that exports nothing as Metro reads it. Where the module comes
  as `{ default }` it is taken from there.
- *Random numbers* come from the platform (`react-native-get-random-values`, a TurboModule). Nothing about keys is made
  from `Math.random`.
- *`crypto.subtle`* is not in Hermes, and OpenPGP raises as it loads without it. A stand-in is installed that hashes (SHA-1, 256,
  384, 512, with `@noble/hashes`), because OpenPGP does not fall back where it hashes, and refuses everything else with a
  `NotSupportedError`, which OpenPGP reads as "use your own" and does, in JavaScript.
- *`Symbol.species`.* Hermes does not look at it, so `concat` on a class that extends `Array` gives a plain array. OpenPGP joins
  the packets of a message that is signed and encrypted with the signature after them that way, and then asks for the ones
  with a tag, which only its own list class knows: reading such a message failed with "undefined is not a function", without
  a stack, since Hermes gives none here. `PacketList.concat` is given back its own class.

**How long it takes**, measured on the emulator and not on a phone, in the JavaScript of Hermes:

| | |
|---|---|
| a key pair (curve 25519) | 0.1 s |
| encrypting and signing, opening and checking (curve 25519) | under 0.1 s |
| opening an RSA 4096 message | 2.4 s |
| signing with RSA 4096 | 8 s |
| opening a private key that is sealed with a passphrase (16 million bytes to hash), in JavaScript | 40 s |
| the same, hashed by the platform (see "What opening a sealed key natively found") | a few seconds |

The last is the one that matters. A key from a mail program is sealed by hashing the passphrase for tens of millions of bytes
(the iterated S2K), which is done at the pace of a script here. It is done once, when the key is taken in: the key is kept
open from then on, in the database, as the desktop keeps it, since a sealed key would ask for its passphrase at every message
read or sent. The screen says so before it begins. A key sealed with Argon2 would need WebAssembly, which Hermes does not have,
and is refused. The hashing is done by the platform now, which is the way to make it seconds.

**Where the private key lives.** In the database (`own_keys`), which is encrypted, as the passwords of the accounts are. No
other place on the phone holds it. The keys of the people written to are in `contact_keys`, by address.

**Writing.** `composeProtected` (`packages/smtp`) hands the content of a message over as an entity of its own, and
`signedBody` and `encryptedBody` (`packages/smtp/src/pgpMime.ts`) put it back as PGP/MIME (RFC 3156), as the desktop writes it:
the addressing stays outside, since every server on the way needs it, and the content with its attachments is signed or
encrypted. The signed part is the entity byte for byte, since the signature covers those bytes. Encrypting signs as well, and
encrypts to the sender's own key too, so that the copy in Sent can be read. A message that is to be encrypted and cannot be (the
account has no key, or a recipient has none) is refused before it is queued, naming those who lack one, and is refused again
where it is written, so that it is never written in the clear. A draft that is to be encrypted is encrypted to its author
alone, as on the desktop, so that autosave does not fail for an address that was typed half an hour ago; a draft that is only
to be signed is kept as it is. Opening such a draft encrypts it again when it is saved.

**Reading.** `readProtected` looks at the top headers of a message before it decodes anything (most mail is neither signed
nor encrypted, and a large message is not decoded for that), and then:

- a *signed* message is checked against every key held for the sender, not only the newest one: a sender who has changed keys
  has signed older mail with the old one. The answers are the desktop's: verified, not checked (no key of the sender), invalid.
  The account's own keys count for a message that is from the account itself, which is what a copy in Sent is.
- an *encrypted* message is opened with whichever key of the account fits, and read as the message it was: the outer headers are
  kept, the content headers come from inside, and so the text, the attachments and the hints are read as for any message.
- the older inline forms (`BEGIN PGP SIGNED MESSAGE`, `BEGIN PGP MESSAGE` in the text) are read as well.

Nothing is kept of the result: not the opened text (an encrypted message is not stored in the list's text, which a search would
read) and not the verdict, since a verdict kept says nothing about the message on the screen. A message that cannot be opened
is shown as it came and said to be encrypted. The hint says what is known, and says less than "authentic" where less is known: a
valid signature is the key's, and whose key it is, is what the user decided when the key was put there.

**Keys.** A screen in the settings: a key pair made on the phone for an account (curve 25519), a key read from a file or from
pasted text (several in one file are found, a private key goes to an account and asks for its passphrase when it is sealed, a
public key to the address it is for), the public half of an own key saved as a file to give away, and removing either, with a
question first. The fingerprint is shown in full, in two lines, for comparing it with what the owner says it is. An expired key
is said to be.

Seen on the emulator: a key made for an account, saved as a file and read back by a program on the PC; an encrypted and signed
message from the PC, which opens with "Verschlüsselt, der Absender ist nicht bestätigt" until the sender's key is read from a
file, and then with the signature checked; a signed message, "Signiert, die Signatur stimmt"; an encrypted reply to the sender,
which was sent to the receiving server and opens on the PC with the signature checked. Covered by tests only: keys sealed with a
passphrase on the phone (the time of the JavaScript was measured, not the screen), RSA keys, the inline forms, a signature that does not
match, a recipient without a key, and the removal of the keys with the account.

Not done (the key server and WKD are in "What looking up a key found"): a message sent to several recipients of whom some have a
key and others none (it is refused, not split), (opening a sealed key faster than the script does is in the section after the next). What was left in this
list at first (expiry and revocation, a default for signing and encrypting, taking a key from a message) is in the next section.

## What finishing OpenPGP found

- *The envelope of a message that cannot be opened* was shown as two attachments (`anhang-1`, `encrypted.asc`), which are all it
  has and nothing the reader asked for. They are not shown now, as the signature of a signed message is not.
- *A key that has expired or was withdrawn* was used all the same, and encrypting to it failed with a message that said nothing.
  `keyState` (`pgpService.ts`) reads from the key itself whether it has expired, whether it was withdrawn, and whether it can
  still encrypt and sign. A message that is to be encrypted uses, for each recipient, the newest key that can: a person who has
  changed keys has the old one held as well, and an old one that has expired is no reason to refuse the new one. When none can,
  the message is refused before it is queued and says whose key has expired, whose was withdrawn, and who has none. The same
  goes for the account's own key, with the older one that works signing when the newest does not. The card of a key says
  "Abgelaufen", "Widerrufen" or "Läuft in N Tagen ab", the last four weeks ahead, as the desktop does.
- *A key can be taken from a message.* An attachment that looks like a file with keys (type `application/pgp-keys`, or a name
  ending in `.asc`, `.gpg`, `.pgp` or `.key`, but not the signature of a message) has "Schlüssel übernehmen", which shows what
  it holds on the screen for keys, to be placed as for any file. Nothing is stored before the user says where it belongs.
- *Signing and encrypting every message* can be switched on in the settings for keys, for the accounts that have a key. A message
  that is started (new, answer, answer to all, passed on) begins as that says and the switch on the message can still be turned
  off. A draft that is opened begins as it was kept. The settings and which accounts have a key are held in memory
  (`ProtectionDefaults`), since a message is started without waiting for the database.
- *No more dots between two things.* The lists said "account · folder" and similar in several places. The account is now a small
  line over the name of the list, the lines of the status are lines, and the others have a comma or a word.

## What opening a sealed key natively found

A private key from a mail program is sealed with a key that is made of the passphrase by hashing the salt and the passphrase,
written one after the other again and again, for a number of bytes: the iterated string-to-key. OpenPGP.js builds those bytes as
one array and hashes it in JavaScript. At OpenPGP.js's own count of 16 million bytes that took 40 seconds on the emulator, for a
key and its subkey together; GnuPG asks for more (about 65 million) when it calibrates, and the time goes with it.

- *The platform hashes.* `IteratedS2k` (Kotlin, `MessageDigest`) feeds the hash from a block of some 64 KiB that is the repeated data,
  so that no array of tens of megabytes is ever made, and `PeregrinePgpModule` hands the hash back as base64 off the thread of the
  script. Only the salt, the passphrase and the count cross the bridge, and the hash comes back.
- *OpenPGP stays in charge of everything else.* `installNativeS2k` replaces `produceKey` on the class of the specifier, which a key
  that is sealed gives (the class is not exported), once. It takes the platform's hash only where the result is the same: the iterated
  specifier, and a hash that is long enough for the key at one go (SHA-1 to SHA-512, 20 bytes or more, for AES-128 and AES-256 with
  SHA-256, which is what OpenPGP.js and GnuPG make). A key that needs two hashes, the other specifiers and Argon2 go the way they went.
  Without the module (a test, a build without it) nothing changes.
- *Tested.* The Kotlin hash against values made with a plain loop in another program, byte by byte, for several counts, among them
  one that is not a whole number of copies and one below the length of the data; the replaced method against OpenPGP's own: the key
  that comes out is the key that went in, for the count a key is sealed with and for another, with a wrong passphrase refused, and with
  the platform asked for the primary key and each subkey, and not asked for a key that needs two hashes.

Seen on the emulator: a key sealed with 65 million bytes was taken for the account within the 11 seconds that this took to type and
to look at, where 16 million took 40 seconds before. The time of the hash itself was not measured apart from that.

## What looking up a key found

The phone could take a public key only from a file or from pasted text. The desktop finds the key of an address itself, by the Web Key
Directory of the address's domain (WKD) and then keys.openpgp.org, and so does the phone now, with the same sources in the same order.

- *Shared addresses.* What can be said without fetching or hashing is in `packages/core/src/keyLookup.ts`, which the desktop's
  `keyDiscovery.ts` uses as well now: the z-base-32 of the hashed local part, the two addresses WKD may publish a key at (the `openpgpkey`
  subdomain first, then the domain itself) and the keyserver's. The hash and the encoding of text come from the platform. Tested against
  the example of the WKD draft (the hash of `joe.doe`) and against the vectors of z-base-32.
- *Asked for, not done for the user.* Asking a server for the key of an address tells it whom the user is about to write to, so the lookup
  runs only when the user types an address on the keys screen and starts it, and the screen says whom it asks (the mail server of the address
  and keys.openpgp.org) and that it does not store anything. It is not done on its own for the recipients of a message, as the desktop's
  discovery is not either.
- *What a server gives is not taken as it comes.* Only a key with a user ID that is the address that was asked for is kept (a server could
  give any key); it is given as a public key whatever the file holds, so that a private key in it cannot be offered for an account; a
  page where a key should be, as hosts with a catch-all route give, is passed over; an answer that is empty or over half a megabyte is not read;
  and a server that does not answer in ten seconds is given up on, for the next. What is found is shown with where it was found, and with its
  fingerprint, to be placed like a key from a file: nothing is stored before the user says whose it is.
- *The ways it fails are told apart.* The servers answered and have no key ("Für … ist kein Schlüssel veröffentlicht", naming the two places
  that were asked), none could be reached ("Gibt es eine Internetverbindung?"), and what is not an address.

Seen on the emulator, on the real network: the address of the GnuPG maintainer's public key, which gnupg.org publishes by WKD, was found on the
`openpgpkey` subdomain, with its fingerprint and "Gefunden im Verzeichnis von gnupg.org (WKD)", as a key without a private half, and "Für … merken"
was offered; the file is binary, so this also shows that the response of `fetch` can be read as bytes on the phone. Not seen on the device: the
keyserver, and the ways it fails (covered by tests with a fetcher that answers as told, and by the same lookup run against the real directory from a PC).

## What a folder that changes under the phone found

The phone kept the messages of a folder by their UID and never asked whether the UIDs still meant what they did. Found when the test
server was reset and the list on the emulator showed rows of messages that were gone.

- *UIDVALIDITY was never kept.* A server that numbers a folder anew (a restore, a mailbox made again, a move to another server) says
  so with a new UIDVALIDITY, and every UID the phone knew then names another message, or none. The list showed messages that were not
  what they said, and what was done to one (starring it, moving it, deleting it) was done to whichever message had that number
  now, also by what waited in the queue. The folder has a column for it (migration 10), as text since the number is 32 bits.
- *A sync forgets what it cannot trust.* `syncFolder` asks the server for the UIDVALIDITY when it decides the range, and when it is not the
  one the folder had, drops the messages of the folder and the actions that waited to be made to them (`resetFolder`): flags, deletes and
  moves that name the folder, which would hit others. A draft that waited to replace a revision in that folder is kept as a draft that
  replaces nothing, so that what the user wrote is not lost and the old revision is left where it is. The folder is then fetched as if it
  were new, and the log says what it cost (`resetText`). A folder that was never synced since this was kept has no UIDVALIDITY to compare
  with: the first sync trusts what is there and records the number, which is all that can be done for the messages of an older version.
- *Messages that were deleted elsewhere stay.* A sync only added and updated what it fetched. After a sync the messages in the range that was
  asked for (the newest 50 and what is newer) that the server did not give are taken out (`dropGone`); what is older than the range is not
  asked about and stays, since not being fetched is not being gone.
- *Not done:* telling the user that changes were given up (it is in the log), and looking at flags of what is older than the range.

Covered by tests: the number kept for each folder, a folder numbered anew (what goes, what stays, the log), the first sync of a folder with
messages and no number, the queue (which actions go, a draft that stays), messages gone elsewhere, an empty folder, and the edge of the range.
Seen on the emulator: three messages synced; the server's inbox then numbered anew (its index removed) with two other messages in it: the next
sync logged that the phone forgot three messages and the list showed the two that the server has. A message deleted on the server then
went from the list at the next refresh. Not seen: the queue part, which is covered by tests only. One more thing seen, and not looked at: after
the test server was restarted the screen said "Keine Verbindung" and the refresh button did not bring the connection back for a minute or more,
only restarting the application did.

## What is still missing next to the desktop

Written on 2026-10-30, after OpenPGP, drafts, push and the folder checks were done, from the desktop's channels (`src/shared/ipcContracts.ts`),
its settings (`AppSettings`) and its pages, set against what the phone has. Effort: S is a part of a pull request, M is one or two, L is several.

**What the phone has that the desktop does not:** push by the system's own service and by a foreground service, notifications that open
the message, a look for mail while the application is closed, the keys sealed by the Keystore, and a sync that checks the numbering of a folder.

**First, because the phone is not a client that can stand alone without them**

1. *History.* (Done as far as loading goes: see "What loading older messages found". What is left is an IMAP search for what is not on the
   phone, and CONDSTORE for the flags, which now come with every sync as a list of the whole folder.) A sync fetched the headers of the newest 50
   messages of a folder and nothing older, ever; search looks only through what was fetched. The desktop synchronises the whole folder.
2. *The phone's own place in the system.* (Done: see "What the phone's place in the system found". What is left is a share target for single people and the "Share" of a message to other applications.)
3. *Setting up and changing an account.* (Done as far as the servers, the logins and the editing go: see "What setting up an account found". What is left is DNS SRV on the phone and OAuth2.)
4. *Folders.* (Done: see "What managing folders found". What is left is subscribing to folders and moving a folder under another.)

**Second, what the desktop's daily use has**

5. *Signature text for each account and several identities.* (Done: see "What identities, a signature and undo send found".)
6. *Sending at a later time.* (Done: see "What sending later found".)
7. *Sorting* and *conversations* (both done, see "What sorting and the first tools found" and "What conversations found").
8. *Saved searches* shown as folders (S to M: the search exists).
9. *Formatted text when writing.* Reading HTML is done; writing is plain text and a formatted draft is refused. There is no good rich editor for the platform
   that does not live in a web view. L, and a decision to make before work.
10. *Tools for a message:* the source, saving it as an `.eml`, printing and saving as a PDF are all done (see "What sorting and the first tools found" and "What printing found").
11. *The safety switches* (done, see "What sorting and the first tools found").
12. *Locking the application.* (Done: see "What locking the application found".)
13. *Appearance:* light, dark or the system's, and a text size are done; a choice of accents, date formats and density are left (M).
14. *Languages.* The desktop has English, German, Spanish, French and Portuguese (`src/renderer/src/i18n`); the phone's texts are German and written into the code. L:
    every text goes through a function, and the files of the languages can be the desktop's where the texts are the same.
15. *Contacts:* a list, adding and changing, vCard in and out (M). On a phone the contacts of the system are the better place to look; see 2.

**Third**

16. *Filter rules.* The engine (`src/main/filters`) is not portable yet, and a rule has to run where mail arrives: here that is the look for mail in the background. L.
17. *The daily list and tasks* (recurring tasks, linked to messages). L, and unclear whether it is wanted on a phone.
18. *Diagnostics:* a log that can be recorded and exported for a bug report (S to M).
19. *What is left of OpenPGP:* publishing the own key to a keyserver, choosing which of several keys signs (the newest does), one key for each of several recipients with the choice shown, and the search for a key started from
    the sender of a message or from a recipient that has none (S to M each; the first and the last are the cheapest).
20. *A wide screen:* two panes for a tablet or a folding phone (M to L).

**Neither has it**

- Signing in with OAuth2. Providers that no longer accept a password (and the app passwords that replace it are not for everybody) cannot be used on either; the desktop's
  wizard says so and stops. This is the largest thing that stands between the application and mail of the big providers. L, and a decision about client registrations.
- Invitations to meetings, read receipts.
- Taking a private key out, to keep a copy or to use it on another device: the desktop exports the public half only, and a phone that is lost loses
  the key with it. A decision about where such a copy may be written, and how it is sealed, comes first.

**An order**

History (1), then setting up and editing accounts (3), then the system's place (2) and folders (4); then undo send and the signature (5, 6), sorting (7) and the tools of a
message (10); OAuth2 as a decision of its own, taken before the phone is shown to anyone who does not have a provider that accepts a password; the rest by what is missed.

## What loading older messages found

A sync fetched the newest 50 messages of a folder and nothing older, ever. The session already asked the server for the flags of *every*
message of the folder at each sync (the desktop uses it to notice removals), and the phone threw that list away.

- *The list of what the server has is used.* After each sync (`reconcile`, in `folderChanges.ts`) every cached message the server no longer has
  is taken out, whatever its age (before, only the newest range was looked at, and a message deleted on another device stayed for good); what was
  read or starred elsewhere shows so; and the number of messages the server has is kept for the folder (migration 11). A message that has a change
  waiting for it in the queue keeps the flags it has here, so that a sync does not undo what the user decided before the queue has told the server.
- *What is new is fetched from the newest message the phone has on*, not the newest 50 each time. If the numbers have run on by more than 500 since
  (the phone was off for a long time), the folder is started anew with the newest 50, since the messages in between would be a hole that loading
  older ones never fills.
- *Older messages are loaded by page* (`loadOlder`, in `sync.ts`): after a sync, which says which UIDs the server has, the highest 50 below the oldest
  the phone has, fetched by number with the new `fetchMessages` of the session (`UID FETCH` of a set, in both the phone's client and the
  desktop's). Taken from that list and not counted down from a UID, so that a folder with gaps in its numbering still gives full pages. The
  folder knows there is more when the server has more messages than the phone has, so there is no button for nothing.
- *In the screens.* A list of a folder ends with "Ältere Nachrichten laden", a spinner while it loads, and scrolling to the end loads on by itself,
  except under a filter (a filter that shows little would otherwise load a whole mailbox to fill itself). The list of all accounts shows 200 at
  first and 100 more each time: more of those the phone has when it has more, and else a page of older ones fetched for the folder of the role of
  each account, one account not holding up the others.
- *Not done:* search on the server for what is not loaded (the search still looks through what the phone has, which now grows), CONDSTORE (the list of
  the whole folder with its flags is asked for at every sync, which is cheap for a mailbox of thousands and not for one of a hundred thousand), and
  the unified list's limit growing without bound as it is scrolled.

Covered by tests: the session's fetch of a set, the reconciling (gone, flags, the queue's changes, flags in another order), what is new since the
last sync, the hole, pages of older messages (the highest below the oldest, in full from a folder with gaps, a message deleted meanwhile, the end), and
the screens' state (the folder and the list of all accounts, one load at a time, no connection).
Seen on the emulator: a folder of 130 messages showed the newest 50 first; scrolling to the end loaded the rest by itself in pages until the list said 130
messages and ended at the first, with no button for nothing; after one message was read and another deleted on the server, a refresh showed the first as
read and the second gone (129 messages). Not seen on the device: the unified list's loading, which is covered by tests.

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
- Hermes and openpgp.js: answered, see "What OpenPGP found".
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

## What setting up an account found

The phone had one form and "Konto entfernen". The servers were typed by hand, only the login for reading was tried, and an account could
not be changed: a new password meant removing the account and with it everything the phone had of it.

- *The servers of an address are found by the code both apps share.* The rounds over the web (the provider's `autoconfig.<domain>`, the
  well-known path of the domain, then Mozilla's database, which is told the domain and not the address) and the presets of the large providers
  moved to `packages/core` (`mailDiscovery.ts`, `providerPresets.ts`); a platform gives how a document is fetched. The desktop keeps its DNS SRV
  step and its own fetch and uses the shared rounds, so the two cannot drift. The desktop had no test of this; the shared code has them (the
  order of trust, the second round only when the first found nothing, HTTPS only, a page that is no configuration, OAuth2 reported).
- *The phone asks only when the user taps "Einstellungen suchen"*, and the screen says whom that asks. A large provider is known by its domain
  and costs no request. The result fills the form, says where it came from, offers the page for an app password where the provider wants one
  and says plainly that a provider which wants OAuth2 cannot be used yet. Not done: DNS SRV (the platform has no lookup for it).
- *Both logins are tried before an account is kept.* The login for sending was never tried, so a wrong one was found when the first message did
  not go. Now it is (`checkSending`: connect, encrypt, log in, send nothing); a failure keeps nothing, lets go of the connection for reading, and says
  "Zum Senden: ..." with what the server said. An account without a server for sending is not tried for it.
- *An account can be changed* ("Konto bearbeiten" on the folder list): name, colour, address, the servers, the logins for reading and
  for sending (the latter may differ). The stored passwords are not put into fields, an empty field means "as it is". Only what changed is
  tried against a server; a change that fails leaves the account as it was, with the reason and the form as typed. The connection that proved a
  new login becomes the account's, and the push service is told.
- The fake server for sending in the tests served one connection only (a close that came late closed the next connection). It starts clean for
  each connection now, which a test of "log in once at setup, once at editing" needed.

Covered by tests: the shared discovery, the phone's fetching (timeouts, size, failures), the form helpers (what changed, empty passwords, a
server for sending taken away), updating an account, and the controller (signing in with a wrong login for sending, saving each kind of change,
failing for reading and for sending).
Seen on the emulator: the form with the search button and the hint of whom it asks; an account made against the test server; "Konto bearbeiten" with
the stored values, the passwords empty, and the colour changed and kept (the dot in the folder list turned). Not seen on the device: the search over
the internet (covered by tests with a fake web) and a wrong login for sending (covered by tests).

## What the phone's place in the system found

The phone was not a mail application of the system: a link to an address, something shared to it, and the people of the address book went nowhere.

- *Links to an address.* The activity takes `mailto:` (`VIEW` and `SENDTO`) and starts a message from it: the addresses before the question mark and
  `to`, `cc`, `bcc`, `subject` and `body` after it (RFC 6068), the rest of a link left unread. Not `attach`, which would name a file of
  this phone: a link in a web page is not to decide what a message carries; and not `in-reply-to`.
- *What is shared.* `SEND` and `SEND_MULTIPLE` of any type: the text is the body, the subject the one the other application gave, the
  addresses it named (`EXTRA_EMAIL` and the copies) the recipients, and each file an attachment, copied into the application's storage as a picked
  one is. A file larger than a message can carry is copied only to one byte past the limit, so that sharing a film costs no more than that, and
  is said and removed. Only `content://` addresses are read: a `file://` path would be read with the permissions of this application, which is
  the one that can read its own database, and the application's own provider is not accepted either (tests in Kotlin).
- *How it reaches the screen.* As with a tap on a notification, the intent is kept natively and JavaScript asks for it at the start and each time the
  application comes to the front, and gets it once. It is written from the first account that can send. Over a message that is being written it is
  not taken: what was typed so far is on the screen and nowhere else, so the request waits for the next time the application comes to the front.
- *The address book.* A switch "Kontakte des Geräts vorschlagen" under Settings, off until the user allows reading the contacts, which is asked for when it is
  switched on (as for notifications). The people it gives are looked up for each typed part and never copied into the database. They come after the people the
  phone has mail from; one who is in both is shown with the name of the address book; the user's own addresses are left out; an address book that cannot be read
  leaves the others.
- *Not done:* offering the phone as a target for a single person (a share shortcut), the "Share" of a message to another application, and reading
  the `Reply-To` or `List-Post` of a link. Opening a `mailto:` while a message is being written does not interrupt it (see above) and so may seem to do nothing.

Covered by tests: the reading of links (fields, case, percent signs, what is not read), what a share makes of a message (text, subject, people, files too large),
the controller (from which account, over what screen, not over writing, no account), the address book (merging, the switch, the permission asked once, a failing
provider), and in Kotlin the intents (which links, which addresses may be read, once only) and the limited copy.
Seen on the emulator: a `mailto:` link with two addresses, a copy, subject and a body of two lines opened a message with all of it and without the `attach` it
also carried; shared text arrived as the body with its subject, and when a message was being written the request did not touch it and was taken when the
application was brought forward again after leaving it; the switch under Settings asked for the permission, and a person of the address book was
suggested while typing in the "An" field. A shared file whose address the sender had not granted was refused by the system (`SecurityException`), the message started
without it, and says so (what `adb` cannot show is a file that was granted: `am` sets no `ClipData`, so a file really copied from another application was not seen
on the device. The copy is the one a picked file goes through).

## What managing folders found

The phone listed folders and opened them. The desktop makes, renames and deletes them, marks a whole folder as read and empties the trash, and `ImapSession` had the commands.

- *A screen for a folder*, from the gear next to the count in its list, and one for a new folder, from "Ordner anlegen" at the foot of the folders. A new one sits at
  the top or under any of the others.
- *Changing the folders themselves is not queued.* A new name or a folder that is gone changes what every other action names, and a rename that waited for a
  connection would let the actions behind it run against a folder that is not there under that name. It needs a connection and says so when there is none. The folders
  are taken from the server after, so that what is shown is what it has, and what it refuses (a name it does not take) is said as it said it, with the form kept.
- *The name is checked first*: not empty, not longer than 100, not the delimiter of the server (which would make a folder inside another), no wildcard or control
  character, and not one that a folder next to it has, whatever the case. Changing only the case of its own name is allowed.
- *A rename keeps the id.* The folder and the ones under it are renamed in the stored folders in place (`renameFolderRows`), where a sync would have seen a new
  folder under a new path: its messages fetched again, and what waited for it in the queue dropped because its folder was gone.
- *The folders with a job* (inbox, drafts, sent, archive, junk, trash) cannot be renamed or deleted, as on the desktop, and the screen says why.
- *Mark all as read and empty* are decisions about messages like any other: made on the stored copy at once, told to the server by the queue, so they work without a connection and
  survive the application being closed. Emptying is for the trash and the junk folder, asks first, and deletes for good. Messages that are put aside are counted too.
- *Not done:* subscribing to folders (what the server lists is what is shown, as it was), moving a folder under another, and a folder that is deleted while the phone has a
  queued action naming it, which the queue drops as it does for any folder that is gone.

Covered by tests: the names and paths, the rename in the stored folders (ids kept, a folder whose path only begins the same way left alone), which messages a decision acts on,
and the controller against the fake server (make, rename, delete, a refusal, no connection, the queue keeping what waited, mark all as read, empty).
- *A mailbox that is open is left before it is renamed or deleted.* Found on the emulator: deleting the folder that had just been opened ended the connection ("Selected mailbox was
  deleted, have to disconnect", Dovecot), so the folder was gone on the server and the phone showed "The connection was closed". The session selects the inbox first when the mailbox,
  or one under it, is the open one (`ImapSession.leave`, with a test in the session's tests); with that the same steps went through.

Seen on the emulator: making a folder, opening it, renaming it, and deleting it after the question, which says what is lost and has the harmless answer filled. Not seen on the device:
mark all as read and empty the trash (covered by the controller's tests against the fake server) and a folder under another.

## What identities, a signature and undo send found

The phone sent from the account's one address, with no signature, at once.

- *Identities* (migration 12, `identities.ts`). A name, an address and a signature, several for each account, one of them the default. Every account has the one
  it has always had, made from its own name and address (the migration makes it for the accounts that are there, and adding an account makes it), and
  it follows the account when its address is changed, unless the user gave it another. Removing the last is refused: an account without one could not
  send. The compose screen offers the account's identities as chips once there are two, and the message goes out from the one that is chosen, with its
  name in `From`; an identity that was taken away since or belongs to another account is the account's own. A draft that is written on again is from the identity
  whose address it was written from. The screen for them is "Absender und Signatur", at the foot of the folders.
- *The signature* is stored with the identity, as the desktop's was moved into its default identity, and is put under the text of a new message, a
  reply and a forward after a line of `-- ` (two hyphens and a space), a reply under what it quotes as on the desktop. It is swapped when the sender is changed, but only when
  it is still as it was put there: a signature that was edited by hand is left, and no second one is put over it.
- *Undo send.* "Senden, Rückgängig möglich für" in the settings (off, 5, 10, 20, 30 seconds; 5 as on the desktop). A message that is sent is queued with a moment before which
  it must not run (`dueAt`, which snooze uses), so it goes by itself when the time is over, from the queue, with or without the screen. A bar over
  every screen says that it is being sent and offers "Rückgängig" with the seconds left. Taking it back removes the action and writes the message on again where it was
  written, with its files, and the server's draft of it is not restored (it had been deleted with the sending). Once the moment has passed it is an action like any
  other and may be under way, so it says "Zu spät" and leaves it. Only the newest message can be taken back.
- *The queue is woken at the moment a held message is due.* Found on the emulator: the first build sent nothing after the time was over. The queue's timer for scheduled
  actions (`rescheduleDue`) was armed only by the desktop's `AccountManager`; on the phone a held message would have gone at the next reconnect, which for a phone that stays
  connected can be never. `MailActions.armDue` sets the timer after each change to the queue and when the application starts (a message held when it was closed is due when it
  is opened), and the timer runs the queue of the accounts that have something scheduled; a test that moves the clock fails without it.
- *Not done:* a signature for HTML (the phone writes plain text), choosing the identity of an answer by the address it was sent to (it starts from the default; the
  sender can be changed), and sending at a later time.

Covered by tests: the identities (add, change, default, remove, the last one kept), the migration of existing accounts, the signature (put, taken out, exchanged,
left when edited), the compose screen's start and the sender of what goes out, the account following, the controller of the senders, the time that is held, and taking
a message back (in time, too late, the newest only, with attachments), against a clock that is moved.
Seen on the emulator: the screen for the senders (an account has its identity, a signature saved and the list coming back), a new message with the signature under the text after the
`-- ` line, the bar "Wird gesendet: ... Rückgängig (4)" counting down, the message arriving at the SMTP server by itself after the five seconds with the signature, and a second message
taken back with "Rückgängig" that came back into the editor with everything and was never sent. Not seen on the device: choosing between two identities on the compose screen (covered by tests).

## What sending later found

The composer refused a message for a later time. Undo send had already made the queue hold actions until a moment (`dueAt`) and wake at it, which is all that sending later needs.

- *"Später senden"* on the compose screen opens the sheet snoozing uses, with its own title and note: the presets with the time each comes to, and a moment of one's own. The message goes into the
  queue until then (`MailActions.send` takes a moment). It is not also held for the time to take it back, since it is in the list of what is planned; a moment that is not ahead is a message sent now, with that time.
- *The status line* says "N Nachrichten sind zum Senden geplant. Ansehen", apart from what waits for a connection, which is a problem where this is a plan. The list ("Geplante Nachrichten") shows to whom,
  what about and when; a tap takes the message out of the queue and writes it on again, which is how it is changed or given up. What the queue keeps of a file is its path, so a message taken back lists
  its attachments with no size until it is sent.
- *What the phone cannot promise:* the message goes at the moment only if the phone has a connection then and the application may run (open, or woken by the background look for mail, whose interval is
  the one set under notifications). The note on the sheet says so. A message that is due when the phone has no connection goes at the next one.

Covered by tests: queuing until the moment, nothing sent before and the message sent at it, by itself through the timer, a moment that is not ahead, the status text, the list, taking one back and too late, and the draft made from a queued message.
Not seen on the device: the sheet and the list on the screen.

## What sorting and the first tools found

Four small things that the desktop has and the phone had not.

- *Sorting* (`listSort.ts`). One order for all the lists, as the desktop has one setting: a chip at the start of the filters opens the eight choices (newest or oldest first, sender A to Z or Z to A, subject, largest or smallest
  first), and it is kept. It orders the list of a folder and the list of all accounts, in the phone, from what is loaded; it does not ask the server, so with older messages not yet loaded the first of a sort is the first of
  what the phone has. The sender is ordered by its name when it has one, the subject without the `Re:` and `Fwd:` in front, numbers as numbers; what is equal stays newest first, and a message without a date is the oldest. The
  search keeps its own order. Not done: sorting on the server, and a different order for each folder.
- *The source of a message* is shown ("Quelltext anzeigen" in the menu behind the last button) as the server has it, selectable, in a type of equal width, cut at 200,000 characters for what is large; "Als .eml speichern" writes
  the whole of it where the user chooses, named from the subject. A message that was opened from an encrypted one has its source shown as the server has it, which is the encrypted one.
- *The safety switches*: the check of links that look wrong, "ask before every link", and the check of attachments that would start a program, each switched under "Sicherheit beim Lesen", as on the desktop and with its defaults (the first and
  last on, the middle off). Switching one off is the user's decision and takes the check away entirely: that is what the setting is. What the page did not say as a link, and every kind of link but the web and the telephone, is
  never opened, whatever is chosen.
- *Light or dark*: "Hell", "Dunkel" or "Wie das System" at the top of the settings, in force at once everywhere (the mode is kept outside React so that the status bar and the first screen follow it too). A font scale, accents and
  date formats are not done.

Covered by tests: every order and its ties, the stored order, the words, the choices of links (off, ask about all, left alone when the page did not say), the attachment check on and off, the source (shown, cut, saved, a failed save),
and the modes. Not seen on the device: the screens of these four (the chip and sheet, the source, the switches, the modes).

## What locking the application found

The phone had the database sealed by the Keystore and no lock of its own: whoever held the unlocked phone and opened the application read the mail.

- *The lock is the screen lock of the phone* (`PeregrineLockModule`, `KeyguardManager.createConfirmDeviceCredentialIntent`): a PIN, a pattern, a password or a biometric, whichever the phone is set to. The application keeps no secret of its
  own, so there is nothing to store or forget, and it is as hard to open as the phone is. A phone without a screen lock cannot have the application locked, and the switch says so. The system's own screen for the lock is used, which is also
  what asks for a biometric where the phone is set to one.
- *When it locks.* At the start, before anything is shown, and when the application comes back after being away for the chosen time (at once, a minute, five or fifteen; a minute by default). While it is locked the screens show nothing of the
  mail, the sidebar and the bar for undo are not there either, and the application goes on behind it (what arrives is fetched, the queue runs). The lock is asked for as soon as the locked screen appears, and by its button when it was cancelled.
  Asking takes the application out of sight for the system's screen, which is not being away: it is not counted, or opening it would lock it again at once.
- *Switching it on or off asks for the lock.* On, to prove that it works before the application depends on it; off, so that whoever has the unlocked phone cannot take it away. When it is not given it says so and nothing changes.
- *The content is kept out of screenshots and out of the list of recent applications* while the lock is on (`FLAG_SECURE`), which a lock that shows the mail in the list of recent applications would defeat. The cost is that the user cannot take
  a screenshot of the application either.
- *What it does not do:* it does not seal the database with the lock (the key is in the Keystore as before and is not tied to the user having just unlocked), so it keeps out someone who uses the application and not someone who takes the
  storage apart; and a notification still shows what the notification settings let it show, over the lock: switch the preview off under the notifications for that.

Covered by tests: when it must lock (time away, none, a clock that went back), the settings, the controller (start, unlock, cancel, a system that cannot be asked, one question at a time, the time away, the question not counting as being away,
on and off asking for the lock, a phone without one) and the settings screen.
Seen on the emulator: without a screen lock the switch is off, disabled and says why; with a PIN set, switching it on opened the system's screen for the lock, and after the PIN the screenshot of the application was black
(`FLAG_SECURE`: the check that it keeps the content out of screenshots); after the application was ended and started again the lock was asked for at once and the application opened after the PIN. Not seen: the locked screen itself (it is
kept out of screenshots, which is what it is for), a time away of a minute, and a wrong PIN.

## What conversations found

The phone listed every message by itself, so a long exchange filled a page with rows about one thing.

- *What a conversation is made of* (migration 13): the Message-ID and the In-Reply-To of each message, which the sync's envelope already carries and was thrown away, are kept (`messages.message_id`, `in_reply_to`). What was stored before has none until a sync
  fetches it again, and is grouped by its subject until then.
- *Grouping* (`threads.ts`, with the desktop's languages for "Re:", "Fwd:", "AW:", "WG:" and the rest). A message that names the one it answers is in its conversation, and so are the ones that answer it, however long the chain. For what that cannot see, a hole in the
  chain because a message was never fetched or a client that does not write the header, messages with the same subject once the "Re:" is taken off belong together when at least one of them says it is an answer. Two first messages with the same subject are two
  conversations (a newsletter every week is not one), and an empty subject joins nothing. `References` is not read: the envelope does not carry it, and fetching it for every message would cost more than the gaps it closes.
- *In the lists* (a folder, and the list of all accounts) a conversation is one row: its newest message, the number of messages, and bold when any of them is not read. The order is the user's (sort), by the newest message of each. A filter is asked of the conversation, so "not read" finds one
  with a message not read in it. A tap on a conversation of several opens "its messages" (the newest first), from which each opens as it does from the list; one of a single message opens at once. A switch under "Listen" ("Antworten zu Konversationen
  zusammenfassen") turns it off, and it is on until then.
- *What it does not do yet:* a swipe, the choice of several rows and a long press act on the newest message of a conversation and not on all of them; a conversation is looked for among what the list has, so one whose older messages are not loaded yet has fewer; the search lists every message as before;
  the messages of a conversation that are in other folders (the answers in the sent folder) are in it only in the list of all accounts' role. A message is not shown in its conversation as a thread of quotes.

Covered by tests: the subject, the grouping (chains, ids without brackets, the hole, newsletters, empty subjects, loops, an id two messages have, dates), the rows (off, on, order, the filter, nothing), the setting, what is kept of the ids, and opening from a conversation. Not seen on the device: the rows and the screen of a conversation
(the emulator did not answer fast enough to be driven this time).

## What a text size found

The phone's texts followed the system's size setting and nothing else.

- *Four sizes* under "Schriftgröße" in the settings (small 0.9, normal, large 1.15, very large 1.3), on top of the system's own setting, which React Native applies to texts already. The choice is kept and is in force at once on every
  screen, held outside React like the light or dark mode so that nothing has to be passed down.
- *How it is done:* every style that has a `fontSize` is multiplied when the styles are made (`scaleStyles.ts`, to the half of a point, the line height with it), once for each theme and size. No component was changed; a text that is not drawn from the styles
  would not follow, and there is none in `ui`. Sizes of anything but text (padding, the height of a row) are left, so a very large text makes a row of two lines rather than a row that is taller than its touch target.
- *Not done:* accents, date formats, density.

Covered by tests: the factors, what is stored, the watching, the setting and the start, and the scaling of styles (text and line heights multiplied, the rest left, normal being the styles themselves). Not seen on the device (the emulator did not answer fast
enough to be driven).

## What printing found

- *"Drucken oder als PDF speichern"* in the menu of a message hands the message to the system's print service (`PeregrinePrintModule`: a web view of its own, `PrintManager`). "Save as PDF" is one of the printers the service offers, so printing and
  making a PDF are one function and the PDF is named after the subject.
- *The page* (`printing.ts`) is the lines above the message (subject, from, to, copy, date, the ones the message has) and then the message as it is read: HTML through the reader's own document builder (nothing that runs, the
  images it carries, under the policy of the reader), and a message that is only text in a block that keeps its lines, escaped.
- *Nothing is fetched for it.* The page is served under the reader's policy with remote images off, and the web view runs no script, reads no file of the application and has network loads blocked, so printing a message does not tell the sender that it was read.
  Images from the sender's servers are therefore not on paper, as in the reader before the user asks for them.
- *Not done:* printing with the remote images the user allowed on the screen, a choice of what goes on the page (the headers in full), and printing several messages or a conversation.

Covered by tests: the name of the job, the page (the lines, a message without one, text escaped, HTML without script and with its inline images, the policy against fetching, the subject), the service through the native module, and the controller (a print, a failure, nothing before the message has arrived). The Kotlin module is compiled by the build.
Not seen on the device (the emulator did not answer fast enough to be driven).
