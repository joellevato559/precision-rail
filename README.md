# Precision Rail Group — Time and Mileage

**Precision Rail Group** · *Once · Twice · Precise*

Professional platform:

Production-oriented fleet platform for **work time**, **drive time (separate pay rate)**, **miles**, **DVIR**, **HOS assist**, **fuel integrity**, **approvals**, and **payroll export**.

GPS is designed for **dedicated vehicle trackers**. Until you name the vendor, a **trip simulator** and **position ingest API** stand in.

> Prototype (single HTML): `../vehicle-clock-tracker.html`  
> This folder: the **professional app** to run and extend.

---

## What is built

| Layer | Status |
|-------|--------|
| Postgres schema + demo seed | Done |
| API (auth, clock, drive, duty, DVIR, expenses, fleet, payroll, integrity, maintenance, **push notifications**, audit, ingest, simulate) | Done |
| Driver app (Home, HOS, clock, drive, inspection, fuel) | Done |
| Manager app (live map, simulate trip, approvals, payroll CSV, integrity, **maintenance alerts**, audit) | Done |
| Integration seams (trackers, fuel cards, accounting, notify, storage) | Documented — plug in when you choose products |

---

## Quick start

### 1. Database

```bash
psql -U postgres -c "CREATE DATABASE precision_rail;"
psql -U postgres -d precision_rail -f db/schema.sql
psql -U postgres -d precision_rail -f db/seed.sql
# If DB already existed before maintenance feature:
# psql -U postgres -d precision_rail -f db/maintenance.sql
# psql -U postgres -d precision_rail -f db/notifications.sql
```

| Login | Password | Role |
|-------|----------|------|
| driver@demo.rail | password123 | driver |
| manager@demo.rail | password123 | manager |
| admin@demo.rail | password123 | admin |

### 2. API

```bash
cd backend
cp .env.example .env    # set DATABASE_URL, JWT_SECRET
npm install
npm run dev             # http://localhost:8080
```

### 3. Driver app

```bash
cd driver-pwa && npx --yes serve -p 5173 .
# http://localhost:5173
```

### 4. Manager app

```bash
cd manager-web && npx --yes serve -p 5174 .
# http://localhost:5174
```

**Demo path:** Manager → select TRUCK-01 → Simulate trip → Driver logs in → Pre-trip → Start Drive → End Drive → Clock out → Manager Approvals → Payroll.

---

## When you choose real products

See **[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)**. Tell us:

1. Tracker / telematics vendor  
2. Fuel card provider  
3. Payroll or accounting system  
4. SMS / email provider (optional)

We add adapters only; core data model and screens stay.

---

## Branding

Official logo: `assets/prg-logo.jpg` (Precision Rail Group / PRG).

## Layout

```
precision-rail-pro/
├── README.md
├── docs/           DATA_MODEL_AND_API · SCREEN_FLOWS · INTEGRATIONS
├── db/             schema.sql · seed.sql
├── backend/        Express API v1.0-mvp
├── driver-pwa/     Driver client
└── manager-web/    Manager client
```

---

## Design docs

1. [Data model & API](docs/DATA_MODEL_AND_API.md)  
2. [Screen flows](docs/SCREEN_FLOWS.md)  
3. [Integrations](docs/INTEGRATIONS.md)  

HOS is **assist only** (not a certified ELD) unless you later pursue FMCSA certification.
