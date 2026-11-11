#!/bin/bash
# Checks an APK before it is given to anybody:
#
#     bash scripts/release/verify-apk.sh path/to/app.apk
#
# The signature is valid, it is NOT the debug key's (an APK signed with that cannot be updated by a properly signed one), and the application is looked
# into for trackers, hosts and permissions (scripts/check-trackers.py). Prints the SHA-256 of the signing certificate, which is what the release notes say, and of the file.
# The exit code is 0 only when all of it holds.
set -e
HERE="$(dirname "$(readlink -f "$0")")"
. "$HERE/common.sh"
APK="$1"
[ -f "$APK" ] || { echo "usage: verify-apk.sh <file.apk>" >&2; exit 2; }
APKSIGNER="$(find_apksigner)" || { echo "apksigner was not found: set ANDROID_HOME to the Android SDK" >&2; exit 1; }

OUT="$("$APKSIGNER" verify --verbose --print-certs "$APK" 2>&1)" || { echo "$OUT"; echo "the signature is NOT valid" >&2; exit 1; }
echo "$OUT" | grep -E "^Verifies|Number of signers|certificate (DN|SHA-256)" | sed 's/^/  /'
if echo "$OUT" | grep -qi "CN=Android Debug"; then
  echo "THIS APK IS SIGNED WITH THE DEBUG KEY. It is not to be given to anybody." >&2
  exit 1
fi
echo "  file SHA-256: $(sha256sum "$APK" | cut -d' ' -f1)"
python3 "$HERE/../check-trackers.py" "$APK" | grep -E "ALARM|No alarm|none of the" | sed 's/^/  /'
python3 "$HERE/../check-trackers.py" "$APK" >/dev/null
echo "verified: $APK"
