# Driver PWA

Mobile-first driver client for Home + Drive flows.

## Run

1. Start the API (`backend`) with DB seeded.
2. Open `index.html` in a browser (or serve the folder):

```bash
npx --yes serve -p 5173 .
# → http://localhost:5173
```

3. API base defaults to `http://localhost:8080/api/v1`.
4. Login: `driver@demo.rail` / `password123`

## Features (wired to API)

- Login / JWT
- Today summary (`GET /me/today`)
- Vehicle select, HOS meters
- Clock in / out
- Pre-trip inspection → Start Drive (handles `PRETRIP_REQUIRED`)
- End Drive → post-trip prompt
- Duty status changes (Driving goes through Start Drive)

## Next

- Offline queue + service worker
- Fuel log + receipt upload
- Job stop list
