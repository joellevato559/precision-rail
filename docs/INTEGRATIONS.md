# Integration plug-in points

This app is built so **real products can be wired later** without rewriting core logic. Until you choose vendors, built-in **simulators and CSV imports** keep the system usable.

---

## 1. GPS / telematics trackers

**Interface:** `POST /api/v1/ingest/positions`  
**Config:** company ingest API key + `trackers.device_imei` / `api_external_id`

| When you choose… | What we plug in |
|------------------|-----------------|
| Geotab, Samsara, Motive, Verizon, Custom MQTT, etc. | A small adapter that maps their webhook/payload → our ingest body |

**Payload we accept today:**
```json
{
  "deviceImei": "3596…",
  "recordedAt": "2026-08-18T18:00:00Z",
  "lat": 32.78,
  "lng": -96.80,
  "speedMph": 42.5,
  "odometerMi": 145230.1,
  "ignitionOn": true
}
```

**Until then:** `POST /api/v1/simulate/trip` moves a vehicle on a path for demos.

---

## 2. Fuel cards

**Interface (planned):** `POST /api/v1/integrations/fuel-card/import` (CSV or vendor API)

Maps external transactions → `expenses` (type=Fuel) with vendor, amount, gallons, card id, timestamp.  
Integrity engine already runs on `expenses` + miles.

**Until then:** drivers log fuel in the Driver app; managers can add via API.

---

## 3. Accounting / payroll

**Interface:** `GET/POST /api/v1/payroll/*` exports CSV with Work vs Drive rows.

| When you choose… | What we plug in |
|------------------|-----------------|
| QuickBooks, Xero, ADP, Paychex, UKG | Exporter that posts the same line items to their API |

**Until then:** download CSV and import manually.

---

## 4. Messaging / alerts

**Hook:** after anomaly create, HOS critical, defect open — call `services/notify.js` (stub).

| When you choose… | Plug in |
|------------------|---------|
| Twilio, SendGrid, Slack | SMS/email/Slack notify implementation |

---

## 5. Object storage (receipts / photos)

**Hook:** expense `receipt_url` and future photo fields.

| When you choose… | Plug in |
|------------------|---------|
| S3, GCS, Azure Blob | Upload helper replacing local/base64 storage |

**Until then:** optional data-URL / path string on expenses.

---

## How to tell us later

Send:

1. **Tracker vendor** + API docs or sample webhook  
2. **Fuel card** provider + export format  
3. **Payroll/accounting** system  
4. **SMS/email** preference  

We implement adapters only — core tables and screens stay the same.

---

## 6. Mobile push notifications

**Interface:** `services/notify.js` + `POST /api/v1/notifications/register-device`

| Env | Purpose |
|-----|---------|
| `NOTIFY_PROVIDER=console` | Default — logs pushes (dev/demo) |
| `NOTIFY_PROVIDER=webhook` | POST to `NOTIFY_WEBHOOK_URL` with tokens + payload |
| `NOTIFY_PROVIDER=fcm` | Firebase Admin — see **docs/FCM_SETUP.md** |

**Client flow**
1. App requests OS permission  
2. Registers token: `{ token, platform: "ios"|"android"|"web" }`  
3. Server stores in `device_tokens` and sends via chosen provider  

**Already triggered**
- Critical fuel integrity flags → managers  
- HOS limit on start drive → that driver  
- `POST /maintenance/check-notify` → managers  
- Manager test + broadcast endpoints  

**When you choose…**

| Product | What we plug in |
|---------|-----------------|
| Firebase Cloud Messaging | `fcm` provider + service account |
| OneSignal / Expo Push | webhook or small provider module |
| APNs direct | iOS path inside provider |

Until then, Enable push on the driver app + Test push on the manager **Push** tab uses `console` (see API logs) and browser `Notification` when permission is granted.
