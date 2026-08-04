# WLS SMS Forwarder — Build Instructions

## Requirements (on your Mac or Windows PC)

- **Android Studio** (or just the Android command-line tools)
  - Download: https://developer.android.com/studio
- **Java 17+** (bundled with Android Studio)
- **Android SDK Platform 34** + **Build Tools 34.0.0**
  - Install via Android Studio → SDK Manager → SDK Platforms + SDK Tools

## Build the APK (command line)

```bash
# 1. Clone / copy this folder to your PC
cd wls-android-forwarder

# 2. Set ANDROID_HOME (skip if Android Studio already set it)
export ANDROID_HOME=$HOME/Library/Android/sdk   # macOS
# export ANDROID_HOME=C:\Users\YourName\AppData\Local\Android\Sdk  # Windows

# 3. Build release APK (signed with debug key for sideloading)
./gradlew assembleRelease

# 4. Find the APK at:
#    app/build/outputs/apk/release/app-release.apk
```

## Build in Android Studio (GUI)

1. Open Android Studio → **Open** → select this `wls-android-forwarder` folder
2. Let Gradle sync finish
3. Menu: **Build → Build Bundle(s) / APK(s) → Build APK(s)**
4. Click **locate** in the notification that appears

## Install on the Android phone

```bash
# With phone connected via USB (USB debugging enabled):
adb install app/build/outputs/apk/release/app-release.apk

# Or transfer the .apk file to the phone and tap it to install
# (Enable "Install from unknown sources" in Settings → Security)
```

## First-run setup on the phone

1. Open **WLS Forwarder** app
2. Tap **Grant Permissions** → allow SMS & Notifications
3. The API URL is already pre-filled:  
   `https://location-tracker-pubpmv9.replit.app/api/wls/ingest`
4. **Allowed Senders** defaults to `CWS,winsystech` — add more if needed
5. Tap **Save Settings**
6. Tap **Send Test SMS** to verify the connection works (check the WLS panel in your dashboard)
7. Leave the app — it runs silently in the background

## How it works

- The app listens for incoming SMS in the background (BroadcastReceiver)
- When an SMS arrives from a matching sender (CWS / winsystech), it POSTs the raw text to your dashboard API
- The dashboard parses the SMS and updates the WLS panel in real-time
- A notification briefly appears on the status bar when a message is forwarded
- Survives phone reboots automatically

## Customising the API URL

If your production URL changes, just open the app, update the URL, and tap Save.  
No need to reinstall — settings are stored on the device.
