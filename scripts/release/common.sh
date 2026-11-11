#!/bin/bash
# What the release scripts share: where the Android SDK tools and a JDK are. Sourced, not run.

# keytool, from the PATH, JAVA_HOME or the JDK that comes with Android Studio.
find_keytool() {
  if command -v keytool >/dev/null 2>&1; then command -v keytool; return; fi
  for candidate in "$JAVA_HOME/bin/keytool" "$JAVA_HOME/bin/keytool.exe" \
    "/c/Program Files/Android/Android Studio/jbr/bin/keytool.exe" "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
    "/opt/android-studio/jbr/bin/keytool"; do
    if [ -x "$candidate" ]; then echo "$candidate"; return; fi
  done
  return 1
}

# apksigner, from the newest build-tools of the Android SDK.
find_apksigner() {
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  for guess in "$sdk" "$HOME/Android/Sdk" "$LOCALAPPDATA/Android/Sdk" "/c/Users/$USER/AppData/Local/Android/Sdk" "$HOME/Library/Android/sdk"; do
    [ -d "$guess/build-tools" ] || continue
    local newest
    newest="$(ls "$guess/build-tools" | sort -V | tail -1)"
    for name in apksigner apksigner.bat; do
      if [ -f "$guess/build-tools/$newest/$name" ]; then echo "$guess/build-tools/$newest/$name"; return; fi
    done
  done
  return 1
}
