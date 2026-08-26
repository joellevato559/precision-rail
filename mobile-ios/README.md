# Precision Rail — iOS FCM push

Swift helpers for Firebase Cloud Messaging + registration with the Precision Rail API.

## Files

| File | Role |
|------|------|
| `Push/PushBootstrap.swift` | Bootstrap Firebase Messaging + APNs token |
| `Push/PushTokenManager.swift` | FCM token → `POST /notifications/register-device` |
| `Push/PushNotificationCenter.swift` | Foreground display + tap handling |
| `Push/LoginHook.example.swift` | When to register after login |

## Setup

1. Follow **docs/FCM_IOS.md** (APNs key → Firebase, `GoogleService-Info.plist`, capabilities).
2. Add Firebase iOS SDK (`FirebaseCore`, `FirebaseMessaging`).
3. Copy the `Push/` Swift files into your Xcode target.
4. In `didFinishLaunching`:

```swift
FirebaseApp.configure()
PushBootstrap.configure(application: application)
```

5. Forward APNs device token:

```swift
func application(_ application: UIApplication,
                 didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    PushBootstrap.didRegisterForRemoteNotifications(deviceToken: deviceToken)
}
```

6. After login: `PushTokenManager.shared.configureBackend(apiBase:authToken:)`.

## Server

```env
NOTIFY_PROVIDER=fcm
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json
```

See `docs/FCM_SETUP.md` and `docs/FCM_IOS.md`.
