#!/bin/bash
# Puts a message into the inbox of a demo account, as if it had just arrived:
#
#     sudo bash scripts/demo/seed.sh <account> "<Name <address>>" "<subject>" <unique number> [file.eml]
#
# `account` is `work` or `home`. The number makes the message-id unique (a message with a number that was used already is a duplicate to a client). Without a
# file the message is a short plain-text one; with one, the file is the whole message and only the headers that are missing are added. The mail is delivered
# with doveadm, so it shows up on the next look of the application, which is what the tests of notifications need.
set -e
D=/tmp/peregrine-dovecot
ACCOUNT="$1"; FROM="$2"; SUBJECT="$3"; NUMBER="$4"; FILE="$5"
if [ -z "$ACCOUNT" ] || [ -z "$FROM" ] || [ -z "$SUBJECT" ] || [ -z "$NUMBER" ]; then
  echo 'usage: seed.sh <account> "<Name <address>>" "<subject>" <unique number> [file.eml]' >&2
  exit 2
fi
USER="$ACCOUNT@demo.test"
DATE="$(date -R)"
{
  echo "From: $FROM"
  echo "To: $USER"
  echo "Subject: $SUBJECT"
  echo "Date: $DATE"
  echo "Message-ID: <demo-$NUMBER-$(date +%s%N)@demo.test>"
  if [ -n "$FILE" ]; then
    # the headers of the file win; the body is what follows its first empty line
    cat "$FILE"
  else
    echo "MIME-Version: 1.0"
    echo "Content-Type: text/plain; charset=utf-8"
    echo
    echo "Hello,"
    echo
    echo "this is message $NUMBER of the demo. Reply if you like."
  fi
} | doveadm -c "$D/dovecot.conf" save -u "$USER" -m INBOX
echo "delivered to $USER: $SUBJECT"
