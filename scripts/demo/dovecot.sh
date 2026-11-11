#!/bin/bash
# Starts a throwaway Dovecot with two demo accounts for trying the phone application, and puts a few messages into them.
# Run it as root on Linux or in WSL (`demo.sh up` does that):
#
#     sudo bash scripts/demo/dovecot.sh [reset]
#
# Accounts `work` and `home` (also as `work@demo.test` and `home@demo.test`), password `demo`, IMAP with TLS on port 1993 and with STARTTLS on 1143. It is not a service: it runs from
# /tmp/peregrine-dovecot and holds no real mail. With `reset` the mailboxes are emptied first. The certificate is made once into scripts/demo/.state, with the
# names the emulator reaches the host by (localhost, 127.0.0.1 and 10.0.2.2), and a new one is made when it has less than a week left.
set -e
HERE="$(dirname "$(readlink -f "$0")")"
STATE="$HERE/.state"
D=/tmp/peregrine-dovecot
mkdir -p "$STATE" "$D/run" "$D/home"

if ! openssl x509 -checkend 604800 -noout -in "$STATE/cert.pem" >/dev/null 2>&1; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$STATE/key.pem" -out "$STATE/cert.pem" -days 60 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:10.0.2.2" >/dev/null 2>&1
  echo "a new certificate was made: the debug build has to be given it again (demo.sh trust) and built"
fi
cp "$STATE/cert.pem" "$STATE/key.pem" "$D/"

id vmail >/dev/null 2>&1 || useradd -r -M -s /usr/sbin/nologin vmail
# The accounts are `work` and `home`, and a login with the domain (`work@demo.test`) is the same account: the domain is taken off (%Ln) for the login and for
# the folder of the mail, so that an application that was set up with either spelling gets the same mailbox.
printf 'work:{PLAIN}demo\nhome:{PLAIN}demo\n' >"$D/users"
cp "$HERE/../../packages/imap/test-server/dovecot.conf" "$D/dovecot.conf"
sed -i -e 's#username_format=%u#username_format=%Ln#' -e 's#home=/tmp/peregrine-dovecot/home/%u#home=/tmp/peregrine-dovecot/home/%Ln#' -e 's#mail_home = /tmp/peregrine-dovecot/home/%u#mail_home = /tmp/peregrine-dovecot/home/%Ln#' "$D/dovecot.conf"

if [ -f "$D/run/master.pid" ]; then
  OLD="$(cat "$D/run/master.pid")"
  kill "$OLD" 2>/dev/null || true
  # Until it is gone: a new one started before that cannot take the ports.
  for _ in $(seq 1 50); do kill -0 "$OLD" 2>/dev/null || break; sleep 0.2; done
fi
if [ "$1" = "reset" ]; then rm -rf "$D/home"; mkdir -p "$D/home"; fi
chown -R vmail:vmail "$D/home"
# Its streams are let go of, so that whoever started this (a pipe, a terminal) is not held until Dovecot ends; what it says goes to its log.
if ! dovecot -c "$D/dovecot.conf" </dev/null >>"$D/dovecot.log" 2>&1; then
  echo "Dovecot did not start:" >&2
  tail -5 "$D/dovecot.log" >&2
  exit 1
fi
sleep 1
ss -ltn | grep -E ':(1143|1993)\b'

# A few messages, once: an account that already has mail is left as it is.
for account in work home; do
  user="$account@demo.test"
  if [ -z "$(doveadm -c "$D/dovecot.conf" mailbox status -u "$user" messages INBOX 2>/dev/null | grep -v 'messages=0')" ]; then
    bash "$HERE/seed.sh" "$account" "Dana Ortiz <dana@northwind.test>" "Budget for the next quarter" 1
    bash "$HERE/seed.sh" "$account" "Northwind Weekly <news@lists.northwind.test>" "Your weekly summary" 2 "$HERE/mails/newsletter.eml"
    bash "$HERE/seed.sh" "$account" "Sam Fischer <sam@contoso.test>" "Lunch on Thursday?" 3
  fi
done
echo "ready: work and home (also as work@demo.test and home@demo.test), password demo"
