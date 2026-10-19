#!/bin/bash
# Starts the throwaway Dovecot. Safe to run again: it replaces the previous instance and keeps
# the mail, so a test can rely on a clean start only by calling reset.sh first.
set -e
D=/tmp/peregrine-dovecot
SRC="$(dirname "$(readlink -f "$0")")"
mkdir -p "$D/run" "$D/home"
id vmail >/dev/null 2>&1 || useradd -r -M -s /usr/sbin/nologin vmail
if [ ! -f "$D/cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$D/key.pem" -out "$D/cert.pem" \
    -days 30 -subj "/CN=localhost" >/dev/null 2>&1
fi
printf 'test:{PLAIN}test\n' > "$D/users"
cp "$SRC/dovecot.conf" "$D/dovecot.conf"
chown -R vmail:vmail "$D/home"
if [ -f "$D/run/master.pid" ]; then kill "$(cat "$D/run/master.pid")" 2>/dev/null || true; sleep 1; fi
dovecot -c "$D/dovecot.conf"
sleep 1
ss -ltn | grep -E ':(1143|1993)\b'
