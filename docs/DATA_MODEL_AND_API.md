# Precision Rail — Data Model & API Specification

Version: 1.0 · Target: PostgreSQL 14+ · API style: REST + JSON · Auth: Bearer JWT

---

## 1. Conventions

- All tables include `company_id` where tenant-scoped (row-level isolation).
- Timestamps are `timestamptz` (UTC storage).
- Money: `numeric(12,2)` USD unless company settings say otherwise.
- Distance: **miles** (`numeric(12,3)`). Speed: **mph**.
- IDs: `uuid` primary keys (gen_random_uuid()).
- Soft delete: `deleted_at` only where noted; pay/compliance records are not hard-deleted.
- Audit: every mutation that affects pay, duty status, or approvals writes `audit_events`.

**Roles** (enum `user_role`):

| Role | Access |
|------|--------|
| `driver` | Own sessions, drives, inspections, expenses |
| `supervisor` | Fleet read, jobs, limited approvals |
| `manager` | Approvals, payroll export, integrity, audit read |
| `admin` | Users, vehicles, trackers, company settings |

---

## 2. Entity relationship (logical)

```
companies
  ├── users / drivers
  ├── vehicles
  │     ├── trackers
  │     ├── positions
  │     ├── work_sessions
  │     ├── drive_segments
  │     ├── inspections → defects
  │     ├── expenses
  │     ├── geofences
  │     └── job_stops
  ├── duty_status_events
  ├── anomaly_flags
  ├── audit_events
  └── pay_periods → pay_period_lines
```

---

## 3. Tables & fields

### 3.1 companies

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| name | text NOT NULL | |
| timezone | text NOT NULL DEFAULT 'America/Chicago' | |
| require_pretrip | boolean DEFAULT true | Block/warn start drive |
| pretrip_max_age_hours | int DEFAULT 12 | |
| hos_assist_enabled | boolean DEFAULT true | |
| drive_pay_label | text DEFAULT 'Drive Rate' | |
| work_pay_label | text DEFAULT 'Regular Rate' | |
| default_jurisdiction | char(2) | e.g. TX |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 3.2 users

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| email | citext UNIQUE | |
| password_hash | text | bcrypt/argon2 |
| name | text NOT NULL | |
| role | user_role NOT NULL | |
| active | boolean DEFAULT true | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 3.3 drivers

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| user_id | uuid UNIQUE FK → users | |
| company_id | uuid FK | |
| license_number | text | |
| license_state | char(2) | |
| license_expires_on | date | |
| medical_expires_on | date | |
| employee_code | text | payroll cross-ref |

### 3.4 vehicles

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid FK | |
| code | text NOT NULL | e.g. TRUCK-01 (unique per company) |
| name | text | |
| plate | text | |
| vin | text | |
| baseline_odometer_mi | numeric(12,3) DEFAULT 0 | Dash calibration |
| current_odometer_mi | numeric(12,3) DEFAULT 0 | Updated from GPS/vendor |
| default_jurisdiction | char(2) | |
| active | boolean DEFAULT true | |
| created_at | timestamptz | |

Unique `(company_id, code)`.

### 3.5 trackers

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid FK | |
| vehicle_id | uuid FK → vehicles | |
| vendor | text | geotab, samsara, custom, … |
| device_imei | text NOT NULL | |
| api_external_id | text | vendor asset id |
| last_seen_at | timestamptz | |
| active | boolean DEFAULT true | |

Unique `(company_id, device_imei)`.

### 3.6 positions

| Column | Type | Notes |
|--------|------|--------|
| id | bigserial PK | high volume |
| company_id | uuid | |
| vehicle_id | uuid | |
| recorded_at | timestamptz NOT NULL | |
| lat | double precision | |
| lng | double precision | |
| speed_mph | numeric(6,2) | |
| heading | numeric(5,1) | optional |
| odometer_mi | numeric(12,3) | if device provides |
| ignition_on | boolean | optional |
| raw | jsonb | vendor payload subset |

Indexes: `(vehicle_id, recorded_at DESC)`, `(company_id, recorded_at DESC)`.

### 3.7 work_sessions

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid | |
| vehicle_id | uuid | |
| driver_id | uuid FK → drivers | |
| clock_in | timestamptz NOT NULL | |
| clock_out | timestamptz | null if open |
| hours | numeric(8,3) | computed on close |
| start_odo_mi | numeric(12,3) | |
| end_odo_mi | numeric(12,3) | |
| odo_miles | numeric(12,3) | Miles while clocked in (ops only; **not** drive pay) |
| gps_miles | numeric(12,3) | GPS path miles while clocked in (ops only; **not** drive pay) |
| status | session_status | `open\|pending\|approved\|submitted` |
| approved_at | timestamptz | |
| approved_by | uuid FK → users | |
| submitted_at | timestamptz | |
| notes | text | |
| created_at | timestamptz | |

**Pay rule:** Work session hours are paid at the **regular rate**. Miles accumulated while clocked in (including driving or idling between jobs) are **tracked for operations** but are **not** paid as drive time.

### 3.8 drive_segments

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid | |
| vehicle_id | uuid | |
| driver_id | uuid | |
| started_at | timestamptz NOT NULL | |
| ended_at | timestamptz | |
| hours | numeric(8,3) | |
| gps_miles | numeric(12,3) | path distance |
| odo_miles | numeric(12,3) | end_odo − start_odo |
| start_odo_mi | numeric(12,3) | |
| end_odo_mi | numeric(12,3) | |
| start_lat / start_lng | float8 | |
| end_lat / end_lng | float8 | |
| jurisdiction | char(2) | IFTA-style |
| pay_category | text DEFAULT 'drive' | Paid at **drive rate** only when driver uses Start Drive → End Drive. Travel to/from job does **not** require clock-in. |
| status | text DEFAULT 'completed' | |
| created_at | timestamptz | |

### 3.9 duty_status_events

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid | |
| driver_id | uuid | |
| vehicle_id | uuid | nullable |
| status | duty_status | `off\|sleeper\|driving\|onduty` |
| started_at | timestamptz NOT NULL | |
| ended_at | timestamptz | null = current |
| source | text | `user\|drive_start\|drive_end\|system` |

### 3.10 inspections

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid | |
| vehicle_id | uuid | |
| driver_id | uuid | |
| type | text | `pretrip\|posttrip` |
| safe_to_operate | boolean NOT NULL | |
| items | jsonb NOT NULL | `[{name,status}]` status: ok\|defect\|na |
| notes | text | |
| defect_count | int DEFAULT 0 | |
| created_at | timestamptz | |

### 3.11 defects

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid | |
| inspection_id | uuid FK | |
| vehicle_id | uuid | |
| item_name | text | |
| description | text | |
| status | text | `open\|resolved` |
| resolved_at | timestamptz | |
| resolved_by | uuid | |

### 3.12 expenses

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid | |
| vehicle_id | uuid | |
| driver_id | uuid | |
| type | text | Fuel, Maintenance, Toll, … |
| amount | numeric(12,2) NOT NULL | |
| quantity | numeric(12,3) | gallons for fuel |
| unit_price | numeric(12,4) | |
| vendor | text | |
| payment_method | text | |
| jurisdiction | char(2) | |
| odometer_mi | numeric(12,3) | |
| notes | text | |
| receipt_url | text | object storage key/URL |
| purchased_at | date | |
| logged_at | timestamptz | |

### 3.13 anomaly_flags

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid | |
| vehicle_id | uuid | |
| expense_id | uuid | nullable |
| code | text | e.g. RAPID_FILLS, MPG_TOO_LOW |
| severity | text | critical\|warning\|info |
| title | text | |
| detail | text | |
| status | text DEFAULT 'open' | open\|dismissed\|resolved |
| created_at | timestamptz | |
| resolved_at | timestamptz | |

### 3.14 geofences

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid | |
| vehicle_id | uuid | nullable = company-wide |
| name | text | |
| lat | float8 | |
| lng | float8 | |
| radius_mi | numeric(8,3) | |
| active | boolean DEFAULT true | |

### 3.15 job_stops

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| company_id | uuid | |
| vehicle_id | uuid | |
| address | text NOT NULL | |
| sequence | int | |
| status | text | pending\|enroute\|arrived\|complete |
| geofence_id | uuid | optional |
| created_at | timestamptz | |
| completed_at | timestamptz | |

### 3.16 pay_periods / pay_period_lines

**pay_periods:** id, company_id, week_start date, week_end date, status (`open|exported`), exported_at, exported_by  

**pay_period_lines:** id, pay_period_id, driver_id, work_hours, drive_hours, work_session_ids uuid[], drive_segment_ids uuid[]

### 3.17 audit_events (append-only)

| Column | Type | Notes |
|--------|------|--------|
| id | bigserial PK | |
| company_id | uuid | |
| actor_user_id | uuid | |
| actor_name | text | denormalized |
| action | text | clock_in, drive_end, timesheet_approve, … |
| entity_type | text | |
| entity_id | text | |
| vehicle_id | uuid | |
| detail | text | |
| created_at | timestamptz DEFAULT now() | |

No UPDATE/DELETE granted to app role.

### 3.18 refresh_tokens (optional)

id, user_id, token_hash, expires_at, revoked_at

---

## 4. Derived rules (server-side)

### Miles
- Prefer sum of filtered haversine segments on `positions` between drive start/end.
- Ignore jumps &gt; 1.25 mi between consecutive points.
- If device sends odometer, also store delta as `odo_miles`.
- Update `vehicles.current_odometer_mi` on each accepted position delta.

### HOS assist (not ELD)
- Driving today: sum `duty_status_events` / drive_segments where status=driving since local midnight.
- On-duty window: driving + onduty since local midnight (MVP simplification).
- 8-day: sum onduty+driving over rolling 8 local days.
- Limits (defaults): 11 h drive, 14 h on-duty, 70 h / 8 days — warn at 90% and at limit.

### Pre-trip gate
- If `companies.require_pretrip` and no `inspections` type=pretrip with `safe_to_operate=true` within `pretrip_max_age_hours` → API returns `409` with code `PRETRIP_REQUIRED` (client may allow override only if company setting `allow_pretrip_override` true — default false for production).

### Payroll
- Work hours: approved `work_sessions` in week (regular rate). Work-session miles are exported for ops but are **not** drive pay.
- Drive hours / drive miles: completed `drive_segments` only (drive rate). Idling or moving while merely clocked in does **not** create drive pay.
- **Auto-end paid drive** (forgot End Drive): closes open `drive_segments` when (1) tracker shows idle ≤3 mph / low movement for `AUTO_END_DRIVE_IDLE_MINUTES` (default 15), (2) clock-out, (3) clock-in with stale open drive, or (4) duty status set to On Duty / Off / Sleeper. After drive ends, HOS status becomes **On Duty only if the driver is still clocked in**; otherwise **Off Duty**.
- Export marks sessions `submitted` and writes pay_period snapshot.

### Fuel integrity (async job)
- RAPID_FILLS: two Fuel expenses &lt; 2 h apart.
- FILL_LOW_MILES: qty ≥ 5 gal and miles within ±36 h window &lt; 3.
- MPG_TOO_LOW / MPG_TOO_HIGH: implied MPG &lt; 4 or &gt; 45.
- MPG_BELOW_BASELINE: &lt; 60% of vehicle median MPG (min 3 samples).
- FUEL_NO_MILES: period fuel $ &gt; 50 and GPS miles &lt; 5.

---

## 5. REST API

Base URL: `/api/v1`  
Headers: `Authorization: Bearer <access_token>`  
Error shape: `{ "error": { "code": "STRING", "message": "Human readable" } }`

### 5.1 Auth

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/auth/login` | `{ email, password }` | `{ accessToken, refreshToken, user }` |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ accessToken }` |
| POST | `/auth/logout` | `{ refreshToken }` | 204 |
| GET | `/auth/me` | — | current user + driver profile |

### 5.2 Admin — company setup

| Method | Path | Roles | Notes |
|--------|------|-------|--------|
| GET/PATCH | `/company` | admin, manager | settings |
| GET/POST | `/users` | admin | list/create |
| PATCH | `/users/:id` | admin | role, active |
| GET/POST | `/vehicles` | admin, manager | |
| PATCH | `/vehicles/:id` | admin | baseline odo, jurisdiction |
| POST | `/vehicles/:id/tracker` | admin | link IMEI |

### 5.3 Driver — time & drive

| Method | Path | Body / notes |
|--------|------|----------------|
| POST | `/duty-status` | `{ status, vehicleId? }` ends previous open event |
| GET | `/duty-status/current` | current + HOS meters |
| POST | `/inspections` | type, items[], safeToOperate, notes, vehicleId |
| GET | `/inspections?vehicleId=` | recent |
| POST | `/sessions/clock-in` | `{ vehicleId }` |
| POST | `/sessions/clock-out` | `{ sessionId }` |
| POST | `/drives/start` | `{ vehicleId, jurisdiction }` → may 409 PRETRIP_REQUIRED / HOS_LIMIT |
| POST | `/drives/end` | `{ driveId }` computes miles from positions |
| GET | `/me/today` | work hours, drive hours, miles, HOS, open drive |

### 5.4 Expenses

| Method | Path | Notes |
|--------|------|--------|
| POST | `/expenses` | multipart: fields + receipt file |
| GET | `/expenses?vehicleId=&from=&to=` | |

### 5.5 Tracker ingest

| Method | Path | Auth |
|--------|------|------|
| POST | `/ingest/positions` | `X-Api-Key: <company_ingest_key>` |

Body (batch allowed):

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

Server resolves IMEI → vehicle, inserts position, advances odometer, evaluates geofences.

### 5.6 Manager — fleet & payroll

| Method | Path | Notes |
|--------|------|--------|
| GET | `/fleet/live` | last position, driver, duty, drive active |
| GET | `/vehicles/:id/timeline` | sessions, drives, inspections |
| GET | `/sessions?status=pending` | approval queue |
| POST | `/sessions/:id/approve` | |
| POST | `/sessions/approve-batch` | `{ ids: [] }` |
| GET | `/payroll/preview?weekStart=YYYY-MM-DD` | work + drive hours by driver |
| POST | `/payroll/export` | `{ weekStart }` → CSV URL + mark submitted |
| GET | `/integrity/flags?status=open` | |
| POST | `/integrity/flags/:id/dismiss` | |
| GET | `/ifta/summary?from=&to=` | miles & fuel by jurisdiction |
| GET | `/audit?from=&to=&vehicleId=` | |
| GET | `/drives/:id/report` | HTML or PDF trip report |

### 5.7 Jobs & geofences (MVP-optional)

| Method | Path |
|--------|------|
| GET/POST | `/vehicles/:id/job-stops` |
| PATCH | `/job-stops/:id` | status transitions |
| GET/POST | `/geofences` |

---

## 6. Example flows

### Start drive
1. Client `POST /drives/start`
2. Server checks open drive, pretrip, HOS soft limits
3. Inserts `drive_segments` (ended_at null) OR holds “active drive” row
4. Closes open duty event; inserts `duty_status_events` status=driving
5. Audit `drive_start`

### End drive
1. `POST /drives/end`
2. Query positions between start and now → gps_miles
3. odo_miles = current_odometer − start_odo
4. Close segment; duty → onduty
5. Audit `drive_end`; enqueue anomaly scan if fuel exists nearby

### Payroll export
1. `GET /payroll/preview` for UI
2. `POST /payroll/export` builds CSV (Work vs Drive rows), marks sessions submitted, writes pay_period + lines, audit

---

## 7. CSV contracts

### Payroll
```
Type,Employee,Vehicle,Start,End,Hours,GPS mi,Odometer mi,Week Start,Week End,Pay Category
Work,...
Drive,...
```

### IFTA summary
```
Jurisdiction,Miles,Fuel Gallons,Fuel Cost,MPG,Period Start,Period End
```

### Audit
```
Time,User,Role,Action,Detail,Vehicle
```

---

## 8. Non-functional requirements

| Concern | Target |
|---------|--------|
| Position ingest | Accept bursts; idempotent on (vehicle_id, recorded_at, lat, lng) optional |
| API latency | p95 &lt; 300 ms excluding file upload |
| Driver offline | Queue clock/drive/inspect locally; sync with conflict policy (server wins on double clock) |
| Retention | positions: 12 months hot; audit: 7 years; receipts: 7 years (configurable) |

---

## 9. Open decisions (product)

1. Must pre-trip be hard-block or warn-only per company?
2. Are drive hours auto-included in payroll or also require approval?
3. Single jurisdiction per drive vs split miles across state lines (phase 2)?
4. Which tracker vendor is first production ingest?

Document decisions in company settings as they are made.


## Overtime rules

**Overtime applies only to hourly work** (`work_sessions` / clock in–out).  
**Drive time** is always flat `drive_rate_hourly` — no OT, does not count toward thresholds.

| Work hours rule | Multiplier |
|-----------------|------------|
| Over 8 hours in a workday | 1.5× |
| Over 12 hours in a workday | 2.0× |
| Over 40 hours in a workweek | 1.5× |
| **7th consecutive work day** | first 8h @ 1.5×, over 8h @ 2.0× |

**Daily vs weekly overlap:** the system calculates pay under the daily method and under the weekly method, then pays the **higher total** (no stacking both).

Payroll preview/export includes `methodUsed` (`daily` or `weekly`) and both comparison totals.
