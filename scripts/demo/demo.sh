#!/bin/bash
# The demo environment for trying the phone application on an emulator, in one place. Run from Git Bash on Windows (it reaches Dovecot in WSL), or on Linux.
#
#     bash scripts/demo/demo.sh up           # Dovecot with two accounts, the SMTP sink, the debug build's trust, adb reverse
#     bash scripts/demo/demo.sh seed <work|home> "<Name <address>>" "<subject>" <unique number> [file.eml]
#     bash scripts/demo/demo.sh status       # what is running, and what the sink received
#     bash scripts/demo/demo.sh down         # stops the sink and Dovecot
#
# In the application: host `localhost` (the emulator reaches the host by `adb reverse`), IMAP port 1993 with TLS, SMTP port 2587 with STARTTLS, the address
# `work@demo.test` or `home@demo.test`, password `demo`. See README.md for the rest.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="$HERE/.state"
mkdir -p "$STATE"

# Where the scripts are as the Linux side sees them, which on Windows is a path in WSL.
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ON_WINDOWS=1 ;; *) ON_WINDOWS= ;; esac
if [ -n "$ON_WINDOWS" ] && command -v wsl.exe >/dev/null 2>&1; then
  HERE_WIN="$(cd "$HERE" && pwd -W)"
  HERE_LINUX="$(MSYS_NO_PATHCONV=1 wsl.exe wslpath -a "$HERE_WIN" | tr -d '\r')"
  linux() { MSYS_NO_PATHCONV=1 wsl.exe -u root -- "$@"; }
else
  HERE_LINUX="$HERE"
  linux() { sudo "$@"; }
fi

sink_pid() { cat "$STATE/sink.pid" 2>/dev/null; }

case "$1" in
  up)
    linux bash "$HERE_LINUX/dovecot.sh"
    bash "$HERE/trust.sh"
    if [ -n "$(sink_pid)" ] && kill -0 "$(sink_pid)" 2>/dev/null; then
      echo "the sink runs already ($(sink_pid))"
    else
      (cd "$HERE/../.." && nohup node scripts/demo/sink.cjs >"$STATE/sink.log" 2>&1 & echo $! >"$STATE/sink.pid")
      sleep 1
      cat "$STATE/sink.log"
    fi
    if command -v adb >/dev/null 2>&1 && [ -n "$(adb devices | sed 1d | tr -d '[:space:]')" ]; then
      adb reverse tcp:1993 tcp:1993 && adb reverse tcp:2587 tcp:2587
    else
      echo "no emulator is running: start it, then run \`adb reverse tcp:1993 tcp:1993\` and \`adb reverse tcp:2587 tcp:2587\`"
    fi
    ;;
  seed)
    shift
    linux bash "$HERE_LINUX/seed.sh" "$@"
    ;;
  status)
    linux bash -c "ss -ltn | grep -E ':(1143|1993)\b' || echo 'Dovecot does not run'"
    if [ -n "$(sink_pid)" ] && kill -0 "$(sink_pid)" 2>/dev/null; then echo "the sink runs ($(sink_pid))"; else echo "the sink does not run"; fi
    [ -f "$STATE/received.txt" ] && echo "received by the sink: $(grep -c '^=====' "$STATE/received.txt") message(s), see $STATE/received.txt"
    true
    ;;
  down)
    if [ -n "$(sink_pid)" ]; then kill "$(sink_pid)" 2>/dev/null || true; rm -f "$STATE/sink.pid"; fi
    linux bash -c 'if [ -f /tmp/peregrine-dovecot/run/master.pid ]; then kill "$(cat /tmp/peregrine-dovecot/run/master.pid)" && echo stopped; fi'
    ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
