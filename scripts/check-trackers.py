#!/usr/bin/env python3
"""
Looks into an Android APK and says what is in it, so that what the application does not do can be seen and not only said. It is run by hand:

    python3 scripts/check-trackers.py [path/to/app.apk]

(without a path it takes the debug APK that `./gradlew assembleDebug` makes). It reads, and changes nothing, and needs nothing but Python.

It reports three things:
  1. The packages of the code (the classes in the .dex files) that are on the list of known trackers, advertising, analytics and crash-reporting SDKs
     below. A package that is on it is an alarm: the list is what a person would be worried to find.
  2. The packages that carry a company's name (Facebook, Google, Microsoft and the like), which is where a name that looks bad can be told from a SDK
     that is bad: `com.facebook.react` is the framework the application is made with, `com.facebook.appevents` would be Facebook's analytics.
  3. The hosts that the code names: in the .dex files and in the JavaScript bundle. Each is said, and the ones that are not in the list of hosts
     the application is meant to know are an alarm. And the permissions the manifest asks for.

The exit code is 1 when there is an alarm and 0 when there is none, so it can be used by whoever wants to, but it is not part of any pipeline.
"""
import re
import struct
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

DEFAULT_APK = Path(__file__).resolve().parent.parent / 'apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk'

# Package prefixes of SDKs that measure, advertise, track or report crashes to a third party. Not exhaustive: it is what is looked for.
TRACKERS = {
    'com.facebook.appevents': 'Facebook analytics',
    'com.facebook.ads': 'Facebook advertising',
    'com.facebook.login': 'Facebook login',
    'com.facebook.share': 'Facebook sharing',
    'com.facebook.sdk': 'Facebook SDK',
    'com.facebook.internal.logging': 'Facebook SDK logging',
    'com.facebook.marketing': 'Facebook marketing',
    'com.facebook.flipper': 'Flipper (a debugging tool that opens a port)',
    'com.google.firebase': 'Firebase',
    'com.google.android.gms.analytics': 'Google Analytics',
    'com.google.android.gms.ads': 'Google advertising',
    'com.google.android.gms.measurement': 'Google measurement',
    'com.crashlytics': 'Crashlytics',
    'io.fabric': 'Fabric',
    'io.sentry': 'Sentry',
    'com.bugsnag': 'Bugsnag',
    'com.microsoft.appcenter': 'App Center',
    'com.mixpanel': 'Mixpanel',
    'com.amplitude': 'Amplitude',
    'com.segment': 'Segment',
    'com.flurry': 'Flurry',
    'com.appsflyer': 'AppsFlyer',
    'com.adjust': 'Adjust',
    'com.onesignal': 'OneSignal',
    'com.branch': 'Branch',
    'com.kochava': 'Kochava',
    'com.singular': 'Singular',
    'com.applovin': 'AppLovin',
    'com.unity3d.ads': 'Unity Ads',
    'com.chartboost': 'Chartboost',
    'com.vungle': 'Vungle',
    'com.mopub': 'MoPub',
    'com.startapp': 'StartApp',
    'com.tapjoy': 'Tapjoy',
    'com.newrelic': 'New Relic',
    'com.datadog': 'Datadog',
    'com.instabug': 'Instabug',
    'com.heapanalytics': 'Heap',
    'com.pendo': 'Pendo',
    'com.clevertap': 'CleverTap',
    'com.braze': 'Braze',
    'com.leanplum': 'Leanplum',
    'com.urbanairship': 'Urban Airship',
    'com.huawei.hms': 'Huawei services',
}

# Names of companies, to be shown with what is under them, so that a name is not taken for what it is not.
COMPANIES = ['com.facebook', 'com.google', 'com.microsoft', 'com.amazon', 'com.apple', 'com.twitter', 'com.tencent', 'com.baidu', 'com.yandex']

# Hosts that may be named in the code, and why. None of them is connected to without the user: the first are looked up only when the user asks (the settings
# of an address, the key of an address), the second are addresses of help pages that are shown and opened in the browser, the third are in the texts of
# standards and of libraries (their documentation, their error messages) and are not connected to at all. Anything else that a host is named is an alarm.
EXPECTED_HOSTS = {
    # Looked up when the user asks.
    'autoconfig.thunderbird.net': 'the settings of the servers of an address (only when asked)',
    'keys.openpgp.org': 'the public key of an address (only when asked)',
    # Help pages that are shown to the user, who opens them in the browser.
    'account.microsoft.com': 'help page: an app password for a Microsoft account',
    'myaccount.google.com': 'help page: an app password for a Google account',
    'appleid.apple.com': 'help page: an app password for an Apple account',
    # Standards, namespaces and the documentation of libraries: written as addresses, not connected to.
    'www.w3.org': 'a namespace', 'schemas.android.com': 'a namespace', 'ns.adobe.com': 'a namespace', 'purl.org': 'a namespace',
    'www.rfc-editor.org': 'a standard', 'datatracker.ietf.org': 'a standard', 'tools.ietf.org': 'a standard', 'www.iana.org': 'a standard',
    'unicode.org': 'a standard', 'www.unicode.org': 'a standard', 'www.ietf.org': 'a standard', 'xmlpull.org': 'a namespace',
    'java.sun.com': 'a namespace', 'xml.apache.org': 'a namespace', 'www.apache.org': 'a licence',
    'github.com': 'documentation of a library', 'reactnative.dev': 'documentation of the framework', 'react.dev': 'documentation of the framework',
    'reactnavigation.org': 'documentation of a library', 'facebook.github.io': 'documentation of the framework', 'crbug.com': 'a bug number in a comment',
    'developer.android.com': 'documentation', 'issuetracker.google.com': 'a bug number in a comment', 'www.android.com': 'documentation',
    'youtrack.jetbrains.com': 'a bug number in a comment', 'developer.mozilla.org': 'documentation', 'openpgpjs.org': 'documentation of a library',
    'localhost': 'this device', 'example.org': 'an example', 'example.net': 'an example', 'example.com': 'an example',
}

HOST_PATTERN = re.compile(rb'https?://([a-zA-Z0-9][a-zA-Z0-9.\-]{2,}\.[a-zA-Z]{2,})')
CLASS_PATTERN = re.compile(rb'L((?:[a-z][a-z0-9_]*/)+)[A-Za-z0-9_$]+;')
PERMISSION_PATTERN = re.compile(rb'(?:android\.permission|com\.android\.[a-z.]+\.permission|org\.[a-z]+\.permission)\.[A-Z_a-z0-9.]+|[a-z]+(?:\.[a-z]+)+\.permission\.[A-Z_a-z0-9]+')


def permissions_of(manifest: bytes) -> set:
    """
    The permissions that the application asks for: the `uses-permission` elements of the binary manifest, which is read as it is made (a pool of strings, and
    elements with attributes), and not by looking for words. Words would find the permission that a component asks of whoever calls it as well.
    """
    def u16(at):
        return struct.unpack_from('<H', manifest, at)[0]

    def u32(at):
        return struct.unpack_from('<I', manifest, at)[0]

    strings = []
    permissions = set()
    at = u16(2)  # the header of the document, then its chunks
    while at + 8 <= len(manifest):
        kind, header, size = u16(at), u16(at + 2), u32(at + 4)
        if size < 8:
            break
        if kind == 0x0001:  # the pool of strings
            count, flags, start = u32(at + 8), u32(at + 16), u32(at + 20)
            utf8 = bool(flags & 0x100)
            offsets = [u32(at + header + 4 * i) for i in range(count)]
            for offset in offsets:
                position = at + start + offset
                if utf8:
                    length = manifest[position]
                    position += 2 if length & 0x80 else 1
                    byte_length = manifest[position]
                    position += 2 if byte_length & 0x80 else 1
                    end = manifest.index(b'\x00', position)
                    strings.append(manifest[position:end].decode('utf-8', errors='replace'))
                else:
                    length = u16(position)
                    position += 2
                    if length & 0x8000:
                        length = ((length & 0x7FFF) << 16) | u16(position)
                        position += 2
                    strings.append(manifest[position:position + 2 * length].decode('utf-16le', errors='replace'))
        elif kind == 0x0102:  # the start of an element
            name = strings[u32(at + 20)] if u32(at + 20) < len(strings) else ''
            if name in ('uses-permission', 'uses-permission-sdk-23', 'uses-permission-sdk-m'):
                attribute_start, attribute_size, attribute_count = u16(at + 24), u16(at + 26), u16(at + 28)
                for i in range(attribute_count):
                    base = at + 16 + attribute_start + i * attribute_size
                    attribute = strings[u32(base + 4)] if u32(base + 4) < len(strings) else ''
                    if attribute == 'name':
                        raw = u32(base + 8)
                        value = strings[raw] if raw < len(strings) else strings[u32(base + 16)]
                        permissions.add(value)
        at += size
    return permissions


def packages_of(dex: bytes) -> dict:
    """The packages that the classes of a dex file are in, with how many each has."""
    found = defaultdict(int)
    for match in CLASS_PATTERN.finditer(dex):
        found[match.group(1).decode().rstrip('/').replace('/', '.')] += 1
    return found


def expected(host: str):
    """Why a host may be named, or None. A host that a bytecode string ran on from (`keys.openpgp.orgmore`) is judged by what it starts with."""
    host = host.lower().rstrip('.')
    for known, why in EXPECTED_HOSTS.items():
        if host == known or host.endswith('.' + known) or (known.count('.') >= 2 and host.startswith(known)):
            return why
    # Hermes keeps the strings of the code joined, so a host can run on into the text that follows it.
    for known, why in EXPECTED_HOSTS.items():
        if host.startswith(known):
            return why + ' (run together with the text after it in the bytecode)'
    return None


def main() -> int:
    apk = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_APK
    if not apk.exists():
        print(f'There is no file {apk}. Build the application first, or give the path of an APK.')
        return 2
    alarms = 0
    packages = defaultdict(int)
    hosts = defaultdict(set)
    with zipfile.ZipFile(apk) as archive:
        manifest = archive.read('AndroidManifest.xml')
        for name in archive.namelist():
            data = None
            if name.endswith('.dex'):
                data = archive.read(name)
                for package, count in packages_of(data).items():
                    packages[package] += count
            elif name.startswith('assets/') and name.endswith('.bundle'):
                data = archive.read(name)
            if data is not None:
                for match in HOST_PATTERN.finditer(data):
                    hosts[match.group(1).decode().lower()].add(name)

    print(f'{apk.name}: {len(packages)} packages with classes in {sum(1 for n in zipfile.ZipFile(apk).namelist() if n.endswith(".dex"))} dex files\n')

    print('1. Known trackers, advertising, analytics and crash reporting')
    hit = False
    for prefix, what in TRACKERS.items():
        matching = {p: c for p, c in packages.items() if p == prefix or p.startswith(prefix + '.')}
        if matching:
            hit = True
            alarms += 1
            print(f'   ALARM  {what} ({prefix}): {sum(matching.values())} classes in {len(matching)} packages')
    if not hit:
        print(f'   none of the {len(TRACKERS)} on the list')

    print('\n2. What the packages of companies are')
    for company in COMPANIES:
        under = defaultdict(int)
        for package, count in packages.items():
            if package == company or package.startswith(company + '.'):
                under['.'.join(package.split('.')[:3])] += count
        for package, count in sorted(under.items()):
            print(f'   {package}: {count} classes')
    if not any(p.startswith(c) for p in packages for c in COMPANIES):
        print('   no package carries the name of a company')

    print('\n3. Hosts that the code names')
    for host in sorted(hosts):
        why = expected(host)
        where = ', '.join(sorted(hosts[host]))
        if why is None:
            alarms += 1
            print(f'   ALARM  {host}  ({where})')
        else:
            print(f'          {host}: {why}')
    if not hosts:
        print('   none')

    print('\n4. Permissions the manifest asks for')
    debug = {'android.permission.DUMP', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.ACCESS_LOCAL_NETWORK'}
    for permission in sorted(permissions_of(manifest)):
        print(f'   {permission}' + ('  (a debug build asks for this one: for the tools of development)' if permission in debug else ''))

    print(f'\n{"ALARMS: " + str(alarms) if alarms else "No alarm."}')
    return 1 if alarms else 0


if __name__ == '__main__':
    sys.exit(main())
