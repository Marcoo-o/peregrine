#!/bin/bash
# Lets the DEBUG build of the phone application trust the certificate of the demo servers, and nothing else: it makes the debug source set
# (apps/mobile/android/app/src/debug) with a network security config whose `debug-overrides` name that one certificate. A release build has none of this, and
# the folder is in .gitignore, so it is never committed.
#
#     bash scripts/demo/trust.sh
#
# Run it after dovecot.sh has made a certificate (also when it made a new one), and build the debug application afterwards.
set -e
HERE="$(dirname "$(readlink -f "$0")")"
CERT="$HERE/.state/cert.pem"
TARGET="$HERE/../../apps/mobile/android/app/src/debug"
if [ ! -f "$CERT" ]; then
  echo "there is no certificate yet: start the servers first (demo.sh up)" >&2
  exit 1
fi
mkdir -p "$TARGET/res/raw" "$TARGET/res/xml"
cp "$CERT" "$TARGET/res/raw/demo_cert.pem"
cat >"$TARGET/AndroidManifest.xml" <<'EOF'
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:networkSecurityConfig="@xml/network_security_config" />
</manifest>
EOF
cat >"$TARGET/res/xml/network_security_config.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <debug-overrides>
    <trust-anchors>
      <certificates src="@raw/demo_cert" />
      <certificates src="system" />
    </trust-anchors>
  </debug-overrides>
</network-security-config>
EOF
echo "the debug build trusts the demo certificate now: $TARGET"
