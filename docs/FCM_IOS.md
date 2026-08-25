# Firebase Cloud Messaging — iOS integration

Server push already uses **FCM** (`NOTIFY_PROVIDER=fcm`). iOS devices need:

1. APNs key uploaded to Firebase  
2. Firebase iOS app + `GoogleService-Info.plist`  
3. App registers for remote notifications and sends the **FCM token** to Precision Rail API  

Swift helpers live in `mobile-ios/Push/`.

---

## 1. Apple Developer — APNs key

1. [Apple Developer](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles** → **Keys**  
2. Create a key with **Apple Push Notifications service (APNs)** enabled  
3. Download the `.p8` file once; note **Key ID** and your **Team ID**  
4. Firebase Console → Project **Settings** → **Cloud Messaging** → **Apple app configuration**  
5. Upload the APNs **Authentication Key** (`.p8` + Key ID + Team ID)

Prefer the **key** method over certificates.

---

## 2. Firebase iOS app

1. Firebase Console → **Add app** → iOS  
2. Bundle ID must match Xcode (e.g. `com.precisionrail.driver`)  
3. Download **`GoogleService-Info.plist`**  
4. Add it to the Xcode target (Copy items if needed)

---

## 3. Xcode project settings

| Setting | Value |
|---------|--------|
| Signing | Your team + matching bundle ID |
| Capabilities | **Push Notifications** |
| Capabilities | **Background Modes** → Remote notifications |
| Package / Pods | FirebaseMessaging, FirebaseCore |

**Swift Package Manager** (recommended):

- `https://github.com/firebase/firebase-ios-sdk`  
- Products: `FirebaseCore`, `FirebaseMessaging`

Or CocoaPods:

```ruby
pod 'Firebase/Core'
pod 'Firebase/Messaging'
```

---

## 4. Wire the app

1. Copy Swift files from `mobile-ios/Push/` into your app target  
2. Call `FirebaseApp.configure()` at launch  
3. Set `Messaging.messaging().delegate`  
4. Request notification permission  
5. After login, call `PushRegistration.shared.registerWithBackend(apiBase:token:)` with the user JWT  

API:

```http
POST /api/v1/notifications/register-device
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "token": "<FCM registration token>",
  "platform": "ios",
  "deviceLabel": "iPhone 15"
}
```

On logout:

```http
POST /api/v1/notifications/unregister-device
{ "token": "<same fcm token>" }
```

---

## 5. Server

```env
NOTIFY_PROVIDER=fcm
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json
```

Same service account used for Android/iOS. FCM delivers to APNs for iOS tokens.

---

## 6. Test

1. Run on a **physical iPhone** (push is unreliable on simulator)  
2. Grant notification permission  
3. Sign in as driver → confirm token registered (`GET /notifications/devices`)  
4. Manager app → **Push** → **Send test to me** (or broadcast to drivers)  
5. Or from server logs after integrity/HOS/maintenance triggers  

---

## 7. Payload handling

Data messages from the API include string data, e.g.:

```json
{ "type": "hos_limit" }
{ "type": "integrity", "count": "2" }
{ "type": "maintenance" }
{ "type": "broadcast" }
```

Handle in `userNotificationCenter(_:didReceive:)` / `MessagingDelegate` as needed (deep link to Drive, Maintenance, etc.).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No token | Physical device, Push capability, `GoogleService-Info.plist` in target |
| Token but no notification | APNs key in Firebase, correct bundle ID, app not force-quit in some iOS versions for silent |
| `sent: 0` on server | Token not registered to that user; check `device_tokens` |
| Wrong project | plist project_id must match service account project |

See also: [FCM_SETUP.md](FCM_SETUP.md) (server credentials).
