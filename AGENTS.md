# Workspace build notes

- On this Windows machine, the `java` command on `PATH` is Java 8 and cannot build the Android project.
- Before running any Android Gradle task, use the project JDK at `C:\Users\ZYY\.jdks\openjdk-24.0.2+12-54` for that command/session. Do not try the system Java first and do not change the machine-wide Java configuration.
- PowerShell example:
  `$env:JAVA_HOME='C:\Users\ZYY\.jdks\openjdk-24.0.2+12-54'; $env:Path="$env:JAVA_HOME\bin;$env:Path"; Set-Location android; .\gradlew.bat <task>`
- Every user-facing Android modification must increment both `versionCode` and
  `versionName` in `android/app/build.gradle` before producing a new APK.
