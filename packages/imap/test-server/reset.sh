#!/bin/bash
# Back to an empty mailbox for the test user.
D=/tmp/peregrine-dovecot
doveadm -c "$D/dovecot.conf" kick test >/dev/null 2>&1 || true
rm -rf "$D/home/test"
mkdir -p "$D/home/test"
chown -R vmail:vmail "$D/home"
echo reset
