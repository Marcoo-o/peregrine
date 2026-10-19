# Building and releasing

How the code turns into something installable, and where each kind of build comes from. The
short version is in the README.

## Installers

`npm run dist:win` produces `dist/Peregrine-<version>-Setup.exe`, `npm run dist:linux` an
AppImage and a `.deb` beside it. Each script only builds for the platform it runs on.
Cross-building an installer needs the target platform's own tooling, which is why the release
workflow uses one runner per platform rather than one machine for both.

The configuration lives in `electron-builder.yml` rather than in `package.json`, because JSON
carries no comments and half of those entries are decisions rather than formalities.

**The Linux packages.** The AppImage runs on any distribution once it is marked executable and
installs nothing. The `.deb` is for keeping it, and it declares `libsecret` among its
dependencies: that is what Electron's `safeStorage` uses on Linux, and without it the
credential store has nowhere safe to put a password.

**No macOS.** Gatekeeper refuses to start an unsigned application at all, which needs an Apple
developer account to fix. The code has nothing platform specific in it, but only Windows and
Linux are built and exercised.

## Where builds come from

Three workflows under `.github/workflows`, each explained at the top of its own file.

| Workflow | When | What it does |
|---|---|---|
| `ci.yml` | every pull request | typecheck, tests and a build, on Windows with Node 22 and 24 |
| `release.yml` | every commit on `main`, every `v*` tag | typecheck and tests, then the Windows installer and the Linux packages, then a release |
| `android.yml` | changes under `apps/mobile` or `packages` | the type check, the native tests and a debug APK that carries its own JavaScript |

**Development builds.** Every commit on `main` replaces a single rolling pre-release tagged
`nightly`, so there is always a current build to try without waiting for a version. One entry,
replaced each time, rather than one per commit: a hundred releases nobody can tell apart is not
a changelog. The tag is not called `main`, because a tag and a branch sharing a name make
every bare `main` ambiguous, and `git push origin main` then refuses to run at all.

**Releases.** Pushing a tag that starts with `v` builds the same files and attaches them to a
draft release:

```
git tag v0.1.0
git push origin v0.1.0
```

The release stays a draft on purpose. Nothing is signed, so both platforms warn on first
launch, and whoever tags a version should get to say so in the notes before anybody downloads
it.

**Checksums.** Every build job computes the SHA-256 of the files it produced and uploads them as
a `checksums-<platform>` artifact. The release job writes them into the text of the release, one
block per platform, and attaches them as `SHA256SUMS.txt` as well. A platform added later only
has to upload its own `checksums-*` artifact to appear there.

The workflow can also be started by hand from the Actions tab. That run builds and uploads the
artifacts to itself, and publishes nothing.

## The Android application

`apps/mobile` is a React Native project and an npm workspace, so `npm install` at the root installs
it with the rest, and its dependencies end up in the root `node_modules`. Gradle and Metro are told
where to look, in `android/settings.gradle`, `android/app/build.gradle` and `metro.config.js`.

What it needs: Node 22.13 or newer (React Native 0.88 says so; the desktop's 22.12 is one release
short), a JDK 17 or newer (Android Studio's own is 21 and works), and the Android SDK with
`ANDROID_HOME` pointing at it. Gradle fetches what is missing from the SDK, platform 37 and NDK
27.1, once the licences are accepted. Gradle itself comes with the wrapper. The first build on a
machine that had none of this took 8 and a half minutes, downloads and React Native's own native
code included, and later ones 2 to 3.

```
npm install
cd apps/mobile/android
./gradlew testDebugUnitTest                       # the certificate check of the native transport
./gradlew assembleDebug -PreactNativeArchitectures=x86_64       # for an emulator
./gradlew assembleDebug -PbundleJs                # a debug APK that starts without Metro
```

Without `-PbundleJs` a debug build loads its JavaScript from Metro: run `npx react-native start`
in `apps/mobile` and, with a device or emulator connected, `adb reverse tcp:8081 tcp:8081`.

**Trying it against a server of your own.** The phone checks the certificate of the server it
connects to against the name it was given, and there is no switch for that. A test server with a
certificate of its own therefore needs one the build is told to trust, and Android has a way to say
that for debug builds only: a `network_security_config` with `debug-overrides` and the certificate
in `android/app/src/debug/res/raw`, which is not part of any release build. The certificate has to
name what the app is given as the host. An emulator reaches the machine it runs on at `10.0.2.2`,
so a certificate with `IP:10.0.2.2` among its names fits, and `adb reverse tcp:1993 tcp:1993`
makes `localhost` reach it too. Keep `src/debug` out of Git, for instance in `.git/info/exclude`:
the certificate is one that was made for one machine.

## First run on a new machine

electron-builder downloads its code signing helper and unpacks it. The archive contains macOS
symlinks, and Windows refuses to create those without developer mode, so the build stops with
`Cannot create symbolic link`. Either turn on developer mode under Settings, System, For
developers, or unpack the archive once by hand. The two macOS files are then missing, which does
not matter for a Windows build:

```
node_modules/7zip-bin/win/x64/7za.exe x -y \
  "%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0.7z" \
  "-o%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0"
```

## Signing

**The result is not signed.** Windows SmartScreen warns on first launch until the program has
enough reach or a code signing certificate is in place. Signing needs `certificateFile` and
`certificatePassword` under `win` in `electron-builder.yml`. A certificate costs money and has
to be issued against a verified identity, so nothing here pretends to sign without one.

## The icon

Two SVG files under `resources/` are the source. `icon.svg` is the full drawing, and
`icon-small.svg` is the same figure without the eye and the malar stripe. Both are needed
because a `.ico` may carry a different image per size, and here it has to. From 32 pixels
downwards the eye and the stripe of the full drawing merge into one dark smudge. `npm run icon`
renders through Chromium and assembles the `.ico` from seven sizes, the full drawing for
256, 128, 64 and 48, the reduced one for 32, 24 and 16.
