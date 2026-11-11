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

( cd "$ROOT/apps/mobile/android" && ./gradlew :app:assembleRelease \
    -PperegrineVersionName="$VERSION" -PperegrineVersionCode="$CODE" -PperegrineRequireReleaseKey=true )

OUT="$ROOT/dist-android"
mkdir -p "$OUT"
NAME="peregrine-$VERSION.apk"
cp "$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk" "$OUT/$NAME"
( cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256" )
bash "$HERE/verify-apk.sh" "$OUT/$NAME"
echo "version $VERSION (code $CODE): $OUT/$NAME and $NAME.sha256"
