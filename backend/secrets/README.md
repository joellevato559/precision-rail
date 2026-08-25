# Firebase / FCM credentials

1. Open [Firebase Console](https://console.firebase.google.com/)
2. Select (or create) your project
3. **Project settings** (gear) → **Service accounts**
4. **Generate new private key** → download JSON
5. Rename/copy to `firebase-service-account.json` in this folder
6. In `backend/.env`:

```
NOTIFY_PROVIDER=fcm
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json
```

7. Restart the API: `npm run dev`

**Never commit the real JSON file.** Only `*.example` belongs in git.

Also enable **Cloud Messaging API** in Google Cloud for that project, and add your iOS/Android/web apps in Firebase so client SDKs can obtain device tokens.
