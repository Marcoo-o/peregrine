# A Dovecot to test the IMAP client against

A throwaway server for `src/main/imap/conformance.test.ts`, which runs the same scenarios through
imapflow and through the client in this package and compares the answers. It holds no real mail, one
account (`test`, password `test`) and a certificate made on the spot. It runs as a process of its own
from `/tmp/peregrine-dovecot`, not as a service, so it leaves nothing behind but that folder.

Linux, or WSL on Windows. Dovecot has to be installed (`sudo apt install dovecot-imapd openssl`), and
if the package starts its own service, stop and disable that one, which is not the one used here
(`sudo systemctl disable --now dovecot`).

```
sudo bash packages/imap/test-server/start.sh     # starts it: 1993 with TLS, 1143 with STARTTLS
sudo bash packages/imap/test-server/reset.sh     # an empty mailbox again
```

Then, from the repository root:

```
IMAP_TEST_HOST=localhost IMAP_TEST_PORT=1993 IMAP_TEST_STARTTLS_PORT=1143 \
IMAP_TEST_USER=test IMAP_TEST_PASSWORD=test NODE_TLS_REJECT_UNAUTHORIZED=0 \
npx vitest run src/main/imap/conformance.test.ts
```

`NODE_TLS_REJECT_UNAUTHORIZED=0` is there because the certificate is the server's own. Nothing in the
application can switch certificate checking off, so this is done outside it, for this run only. The
suite takes a bit over a minute, nearly all of it waiting: for imapflow to start listening, which it
does after fifteen seconds of quiet, and for the greeting that a server never sends to a client that
asked for STARTTLS on a port that already expects TLS.

The same suite works against any other server, a real account included. It only touches folders it
creates itself, named `peregrine-conformance-…`, and deletes them at the end. Leave the two
`IMAP_TEST_*` ports out if there is no STARTTLS port to test, and `IMAP_TEST_PORT` defaults to 993.
