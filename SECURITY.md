# Security

## Reporting a vulnerability

Please report privately through GitHub's security advisory form on this
repository, under Security, rather than opening an issue. An issue is public
from the moment it is filed, and a mail client is a poor place to learn about
a hole from the people exploiting it.

Useful in a report: what an attacker controls, what they get, and the smallest
message or file that shows it. A crafted `.eml` says more than a description.

## What this software assumes

Every message is treated as hostile input. It arrives from a stranger, it is
formatted by the sender, and nothing in it is trusted because of how it looks.

- Message HTML is sanitised, then served as its own document under its own
  content security policy, from a scheme with a one time address per message.
  Scripts, frames, objects and form elements do not survive. The policy is
  built in the main process, not by the window that displays the message.
- Remote content is not fetched until the reader asks for it. That includes
  images, stylesheets, fonts and anything a stylesheet would pull in. A
  request to the sender's server tells them the message was opened, and for a
  stylesheet it can also carry what the message chose to encode in the URL.
- An attachment name is written by the sender, so it is cleaned before it is
  used as a file name, and the result is checked to be inside the cache
  directory before anything is written.
- Opening an attachment reads the file, not its name. Content that runs is
  refused, and so is content that disagrees with its extension.
- Links are examined before they open. An address built to read as one domain
  and resolve as another is put in front of the reader first.
- The database is encrypted with SQLCipher when the profile has a password.
  Without the password the application cannot reach any server.
- The transport is what was asked for. Choosing STARTTLS makes the upgrade
  mandatory: a server that does not offer it fails the connection rather than
  falling back to plaintext, because whether it offers it is announced before
  any encryption exists and can be struck from that announcement in transit.
- Nothing about a message is asked of a third party. The spam verdict shown is
  the one the delivering server already wrote into the headers, never a
  blocklist lookup, which would tell its operator who writes to this mailbox
  and when. The spell checker runs locally against dictionaries fetched once.

## What is out of scope

- An attacker who already runs code as your user account. At that point the
  profile password is the only thing between them and the mail, and it is
  entered at the keyboard.
- The privacy of mail in transit beyond what TLS and OpenPGP provide. A
  message sent unencrypted is readable by the servers that carry it, and no
  client can change that.
- Content of a message that is merely misleading rather than technically
  malicious. Peregrine points out what it can recognise and does not claim to
  recognise everything.

## Supported versions

The most recent release. Peregrine does not update itself and does not check
whether it could, so a new version is installed by hand: on Windows by running
the setup program again, on Linux by replacing the AppImage or installing the
newer `.deb`. Profiles are kept in both cases.

Releases are not signed. Windows SmartScreen warns on first launch, and the
Linux packages carry no signature either. Verify what you downloaded against
the checksums on the release page if you did not build it yourself.
