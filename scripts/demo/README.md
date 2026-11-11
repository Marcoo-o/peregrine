# The demo environment for the phone application

Mail servers on this machine, for trying the application on an emulator without a real account: a Dovecot with two accounts and a few messages, and a mail
server that takes what the application sends. Nothing here is a service or holds real mail, and none of it is part of the application.

You need an emulator (or a phone) with the debug build, `adb`, and on Windows WSL with Dovecot (`sudo apt install dovecot-imapd openssl`) next to Git Bash.

```
bash scripts/demo/demo.sh up       # Dovecot, the sink, the debug build's trust, adb reverse
bash scripts/demo/demo.sh status
bash scripts/demo/demo.sh down
```

`up` starts, in this order:

1. **Dovecot** (`dovecot.sh`, as root in WSL or on Linux) with `work@demo.test` and `home@demo.test`, password `demo`, three messages each, IMAP with TLS on
   1993 and with STARTTLS on 1143. The certificate is made once into `scripts/demo/.state/` with the names the emulator reaches the host by (`localhost`,
   `127.0.0.1`, `10.0.2.2`) and is made anew when less than a week of it is left. It is the configuration of `packages/imap/test-server`.
2. **The trust of the debug build** (`trust.sh`): makes `apps/mobile/android/app/src/debug` with a network security config whose `debug-overrides` name that one
   certificate. A release build has none of it, and the folder is in `.gitignore`. After a new certificate, build the debug application again.
3. **The sink** (`sink.cjs`): SMTP with STARTTLS on 2587 that accepts every login and writes what it receives to `scripts/demo/.state/received.txt`.
4. **`adb reverse`** for 1993 and 2587, so that `localhost` in the emulator is this machine. Without a running emulator it says what to run later.

## In the application

Add an account with the address `work@demo.test`, password `demo`, host `localhost`, IMAP port 1993 with TLS, SMTP host `localhost`, port 2587 with
STARTTLS. The second account is `home@demo.test`.

## New mail while the application is in the background

```
bash scripts/demo/demo.sh seed work "Dana Ortiz <dana@northwind.test>" "Budget" 10
bash scripts/demo/demo.sh seed home "Northwind Weekly <news@lists.northwind.test>" "Weekly" 11 scripts/demo/mails/newsletter.eml
```

The number makes the message-id unique: use a new one each time. In the settings, "Check now" has the application look at once; the notification comes a
few seconds after it, with the application on the home screen. `mails/suspicious.eml` is a message whose link says one address and goes to another, and has a
script in it, for trying what the application does about those.

## Driving the emulator by adb

The screen is 1080x2400. `adb exec-out screencap -p > screen.png` takes a screenshot, `adb shell input tap X Y` taps (X and Y are pixels of that screen),
`adb shell input text "a%sb"` types (a space is `%s`), `adb shell input keyevent 4` is Back and `3` is Home. Open the notifications with
`adb shell cmd statusbar expand-notifications`, close them with `collapse`. The on-screen keyboard moves the fields: tap one field at a time and look.
If the emulator has several users, start the application for the one that is in front: `adb shell am get-current-user`, then
`adb install -r --user <id> app-debug.apk` and `adb shell am start --user <id> -n com.peregrinemobile.dev/com.peregrinemobile.MainActivity`.

## What it is not

A model of a real provider: it has no rate limits, no spam folder logic, and the certificate is its own, which only the debug build trusts. Do not point it at
anything else.
