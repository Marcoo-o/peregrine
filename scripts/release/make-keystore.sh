#!/bin/bash
# Makes the key that releases of the phone application are signed with, once.
#
#     bash scripts/release/make-keystore.sh [path]
#
# The key goes to ~/.peregrine/release.keystore (or the path given), OUTSIDE the repository, and keytool asks for its passwords. Then it says what to put into
# ~/.gradle/gradle.properties so that `build-apk.sh` finds it. It does not write the passwords anywhere.
#
# Read this before running it: the key is the identity of the application. A phone only installs an update that is signed with the same key as what is on it,
# so with the key lost (or published) there are no updates for anybody who has the application, ever. Keep two copies of the keystore and of its password, apart from
# each other and from the repository, and never put it into CI or into a chat.
set -e
HERE="$(dirname "$(readlink -f "$0")")"
. "$HERE/common.sh"
STORE="${1:-$HOME/.peregrine/release.keystore}"
KEYTOOL="$(find_keytool)" || { echo "keytool was not found: install a JDK, or Android Studio, or set JAVA_HOME" >&2; exit 1; }

if [ -e "$STORE" ]; then
  echo "$STORE exists already, and is not overwritten: a key that is replaced cannot update what was signed with the old one" >&2
  exit 1
fi
mkdir -p "$(dirname "$STORE")"
echo "Making $STORE. keytool asks for a password for the keystore and then for the key (the same is fine) and for a name, which is shown in the certificate."
"$KEYTOOL" -genkeypair -v -keystore "$STORE" -alias peregrine -keyalg RSA -keysize 4096 -validity 10000
chmod 600 "$STORE" 2>/dev/null || true

echo
echo "Done. Add this to ~/.gradle/gradle.properties (the passwords are yours to type; nothing was written for you):"
echo
echo "    peregrineReleaseStoreFile=$STORE"
echo "    peregrineReleaseStorePassword=<the keystore password>"
echo "    peregrineReleaseKeyAlias=peregrine"
echo "    peregrineReleaseKeyPassword=<the key password>"
echo
echo "Then make two copies of $STORE and of the passwords, somewhere apart. The SHA-256 of the certificate (which belongs in the release notes, so that anybody can check it) is printed by build-apk.sh for each build."
