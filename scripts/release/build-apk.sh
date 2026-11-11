#!/bin/bash
# Builds a signed release APK of the phone application, checks it, and puts it with its checksum into dist-android/:
#
#     bash scripts/release/build-apk.sh <versionName> [versionCode]
#
# For example `build-apk.sh 1.0.0`. The version code is what the system compares to tell an update from an older build, and only ever goes up: without
# one it is the number of commits on this branch. It needs the release key (see make-keystore.sh); without it the build stops, and does not fall back to
# the debug key. The APK is verified at the end (verify-apk.sh), and nothing is uploaded: giving it to people is `gh release create` by hand, see docs/mobile.md.
set -e
HERE="$(dirname "$(readlink -f "$0")")"
ROOT="$HERE/../.."
VERSION="$1"
[ -n "$VERSION" ] || { echo "usage: build-apk.sh <versionName> [versionCode]" >&2; exit 2; }
CODE="${2:-$(git -C "$ROOT" rev-list --count HEAD)}"

# The key: the keystore made by make-keystore.sh and its alias, unless something else is set. The passwords are asked for here, in a terminal, when they are not
# in the environment or in ~/.gradle/gradle.properties: they are not written anywhere, and are in the environment of this one build only.
export PEREGRINE_RELEASE_STORE_FILE="${PEREGRINE_RELEASE_STORE_FILE:-$(cygpath -m "$HOME/.peregrine/release.keystore" 2>/dev/null || echo "$HOME/.peregrine/release.keystore")}"
export PEREGRINE_RELEASE_KEY_ALIAS="${PEREGRINE_RELEASE_KEY_ALIAS:-peregrine}"
if ! grep -qs "^peregrineReleaseStorePassword=" "$HOME/.gradle/gradle.properties" && [ -z "$PEREGRINE_RELEASE_STORE_PASSWORD" ]; then
  if [ -t 0 ]; then
    read -r -s -p "Keystore password (nothing is shown): " PEREGRINE_RELEASE_STORE_PASSWORD
    echo
    read -r -s -p "Key password (empty if it is the same): " PEREGRINE_RELEASE_KEY_PASSWORD
    echo
    export PEREGRINE_RELEASE_STORE_PASSWORD PEREGRINE_RELEASE_KEY_PASSWORD="${PEREGRINE_RELEASE_KEY_PASSWORD:-$PEREGRINE_RELEASE_STORE_PASSWORD}"
  else
    echo "No password: run this in a terminal, or set PEREGRINE_RELEASE_STORE_PASSWORD." >&2
    exit 1
  fi
fi

( cd "$ROOT/apps/mobile/android" && ./gradlew :app:assembleRelease \
    -PperegrineVersionName="$VERSION" -PperegrineVersionCode="$CODE" -PperegrineRequireReleaseKey=true )

OUT="$ROOT/dist-android"
mkdir -p "$OUT"
NAME="peregrine-$VERSION.apk"
cp "$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk" "$OUT/$NAME"
( cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256" )
bash "$HERE/verify-apk.sh" "$OUT/$NAME"
echo "version $VERSION (code $CODE): $OUT/$NAME and $NAME.sha256"
