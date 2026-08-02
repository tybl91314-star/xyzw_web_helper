# Android Release signing

The release key is intentionally excluded from Git. Keep `app/xyzw-release.jks`
and its passwords backed up securely. Losing the key prevents future APKs from
updating an installed release build.

The build reads these local environment variables:

- `XYZW_RELEASE_STORE_PASSWORD`
- `XYZW_RELEASE_KEY_PASSWORD`
- `XYZW_RELEASE_KEY_ALIAS` (defaults to `xyzw-release`)
- `XYZW_RELEASE_STORE_FILE` (defaults to `xyzw-release.jks`, relative to `android/app`)

Build after the web assets have been synchronized:

```powershell
pnpm build
pnpm exec cap sync android
Set-Location android
.\gradlew.bat assembleRelease
```

The generated APK is placed under `app/build/outputs/apk/release/` and includes
the app version in its filename.
