# Manager Web

Live fleet dashboard mapped to `GET /api/v1/fleet/live`.

## Run

1. Start the API with seed data.
2. Serve this folder:

```bash
npx --yes serve -p 5174 .
# → http://localhost:5174
```

3. Login: `manager@demo.rail` / `password123`

## Features

- Leaflet map with vehicle markers from last GPS position
- Side list: status (Driving / Online / Offline), driver, speed, odometer
- Click card to center map
- Manual refresh

## Next

- Approvals queue, payroll export, integrity flags, vehicle detail timeline
