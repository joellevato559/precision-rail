# Firebase Cloud Messaging (FCM) setup

Precision Rail sends server-side push via **firebase-admin** when `NOTIFY_PROVIDER=fcm`.

---

## 1. Create Firebase project

1. Go to https://console.firebase.google.com/
2. Add project (or use existing)
3. Add your apps:
   - **Android** — package name matching the driver app
   - **iOS** — bundle ID + upload APNs key/cert in Cloud Messaging settings
   - **Web** (optional) — for browser push later with VAPID

---

## 2. Service account (server credentials)

1. Project **Settings** → **Service accounts**
2. **Generate new private key** → download JSON
3. Store securely on the API host:

```bash
mkdir -p backend/secrets
cp ~/Downloads/your-project-firebase-adminsdk.json \
   backend/secrets/firebase-service-account.json
chmod 600 backend/secrets/firebase-service-account.json
```

4. Configure `backend/.env`:

```env
NOTIFY_PROVIDER=fcm
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json
# Optional:
# FIREBASE_PROJECT_ID=your-project-id
```

Alternative for containers/secret managers:

```env
NOTIFY_PROVIDER=fcm
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
```

---

## 3. Install & run API

```bash
cd backend
npm install          # installs firebase-admin
cp .env.example .env # then edit FCM paths
npm run dev
```

On startup (first push), logs should show:

```text
[notify] FCM initialized for project your-project-id
```

---

## 4. Client device tokens

Mobile apps must obtain an **FCM registration token** and call:

```http
POST /api/v1/notifications/register-device
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "token": "<fcm-device-token>",
  "platform": "android",
  "deviceLabel": "Pixel 8"
}
```

`platform`: `ios` | `android` | `web`

The current driver web UI registers a **web placeholder token** for demos. Real phones need the Firebase SDK in a native or Capacitor/React Native app.

---

## 5. Verify

1. Driver (or manager) app registers a real FCM token  
2. Manager → **Push** → **Send test to me**  
3. Device should receive the notification  
4. API `notification_log` table records `status=sent` and `provider=fcm`

Invalid tokens are auto-deactivated.

---

## 6. Google Cloud APIs

In Google Cloud Console for the same project, ensure enabled:

- Firebase Cloud Messaging API  
- (Often already on with Firebase)

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `FCM requires FIREBASE_SERVICE_ACCOUNT_...` | Path/JSON env not set |
| `service account file not found` | Wrong path relative to `backend/` cwd |
| `Permission denied` | Service account role / API not enabled |
| `sent: 0` / no_device | User never called register-device |
| Token errors | App uses different Firebase project than server |

---

## Security

- Do **not** commit `firebase-service-account.json`  
- Restrict file permissions (`chmod 600`)  
- Prefer secret manager in production over flat files  
- Rotate keys if exposed

---

## iOS client

See **[FCM_IOS.md](FCM_IOS.md)** for APNs key upload, Xcode capabilities, and Swift helpers in `mobile-ios/Push/`.
