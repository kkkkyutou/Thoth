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

## iOS

iOS local build requires macOS with Xcode. Linux cannot produce a real iOS build.

Commands:

```bash
npm run package:ios:prebuild
npm run package:ios:build
```

On Linux, these scripts must report a clear macOS/Xcode requirement and must not claim a successful iOS build.

## Web/App

The app web export flow is present in `packages/app`, but it is not part of the first foundation gate.

## Relay

Relay build/typecheck/test are part of the foundation gate. Cloudflare deploy is never automatic and requires explicit user authorization.

## Desktop

Desktop packaging depends on app export, daemon/CLI build outputs, signing/notarization and platform-specific tooling. It is not part of the foundation gate.

## Voice/Audio Policy

Current MVP does not include voice, speech, dictation or audio. Packaging config must not request audio or microphone permissions.
