# Packaging

This document describes local packaging flows. It does not authorize release, push, tag creation, cloud deploys or store submission.

## Android Debug APK

Android Debug APK is the required local mobile artifact for the first-day infrastructure gate.

Commands:

```bash
npm run doctor:android
npm run setup:android-toolchain
npm run package:android:debug-apk
```

Toolchain policy:

- JDK 17 under `.dev/jdk-17`
- Android SDK under `.dev/android-sdk`
- Gradle user home under `.dev/gradle`
- Generated native project under `packages/app/android/`
- APK output under `packages/app/android/app/build/outputs/apk/debug/app-debug.apk`

The Android packaging script maps `http_proxy`/`https_proxy` environment variables into Gradle
JVM proxy options when present.

The APK is not committed. The packaging script writes a local receipt under `.agent-os/artifacts/android-debug-apk.json` with:

- command
- absolute APK path
- sha256
- byte size
- timestamp

Current verified debug artifact from the runtime isolation run:

- Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/app/android/app/build/outputs/apk/debug/app-debug.apk`
- sha256: `9579e3cb43637b6380faf2890eb496d43d7a7cc9779c787afdf16f9d98a70fa0`
- Bytes: `302700513`
- Package: `sh.thoth.debug`
- Permission check: does not request `android.permission.RECORD_AUDIO`

## iOS

iOS local build requires macOS with Xcode. Linux cannot produce a real iOS build.

Commands:

```bash
npm run package:ios:prebuild
npm run package:ios:build
```

On Linux, these scripts must report a clear macOS/Xcode requirement and must not claim a successful iOS build.

## Web/App

The app web export flow uses the real product UI, not a mock review shell.

Commands:

```bash
npm run build:web
THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6688 HOST=0.0.0.0 PORT=8082 npm run serve:web
```

Local human review URL:

```text
http://127.0.0.1:8082/
```

Current public mapping for this environment:

```text
http://180.76.242.105:8148/
```

The public web entry proxies `/ws` back to the local Thoth daemon when
`THOTH_DAEMON_PROXY_TARGET` is set. External devices that cannot use that direct web entry must
still render the real Welcome / Add Host / Paste pairing link experience and use relay pairing.

## Relay

Relay build/typecheck/test are part of the foundation gate. Production deploy is never automatic and requires explicit user authorization.

Current test relay authority is the independent private repository:

```text
SeeleAI/Thoth-Relay
```

Current test endpoint:

```text
https://relay.test.thoth.seeles.ai/health
wss://relay.test.thoth.seeles.ai/ws
```

The test relay accepts browser origins broadly for development convenience, but still requires relay v3 role-scoped tokens through `Sec-WebSocket-Protocol`. Pairing tokens are automatic credentials and must not be placed in URL query parameters, logs, screenshots or documentation examples.

## Desktop

Desktop packaging depends on app export, daemon/CLI build outputs, Electron Builder and platform-specific tooling. It is not part of the foundation gate.

Linux AppImage command:

```bash
npm run package:desktop:linux-appimage
```

Current verified local artifact:

- Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/desktop/release/Thoth-x86_64.AppImage`
- sha256: `6fc25b0f92cf930b5f7e43d6eb11de8a466cc54f881e8fcbb832f288acd1fd43`
- Bytes: `131375945`
- Packaged smoke: passed with an isolated desktop-managed daemon on a temporary port

`packages/desktop/release/` is local artifact output and must not be committed.

## Runtime Isolation Packaging Rule

Packaged desktop smoke, Android debug builds and web preview must not stop or reuse the reserved local legacy daemon on `127.0.0.1:6767`. Thoth direct daemon defaults to `127.0.0.1:6688`; packaged smoke should use an isolated temporary home and port when it launches a managed daemon.

## Voice/Audio Policy

Current MVP does not include voice, speech, dictation or audio. Packaging config must not request audio or microphone permissions.
