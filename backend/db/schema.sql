-- Precision Rail Time and Mileage
-- PostgreSQL 14+ initial schema
-- Units: miles, mph, USD

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('driver', 'supervisor', 'manager', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM ('open', 'pending', 'approved', 'submitted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE duty_status AS ENUM ('off', 'sleeper', 'driving', 'onduty');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Companies & users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL,
  timezone                  text NOT NULL DEFAULT 'America/Chicago',
  require_pretrip           boolean NOT NULL DEFAULT true,
  pretrip_max_age_hours     int NOT NULL DEFAULT 12,
  allow_pretrip_override    boolean NOT NULL DEFAULT false,
  hos_assist_enabled        boolean NOT NULL DEFAULT true,
  drive_pay_label           text NOT NULL DEFAULT 'Drive Rate',
  work_pay_label            text NOT NULL DEFAULT 'Regular Rate',
  default_jurisdiction      char(2),
  ingest_api_key_hash       text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  email           citext NOT NULL,
  password_hash   text NOT NULL,
  name            text NOT NULL,
  role            user_role NOT NULL DEFAULT 'driver',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

CREATE TABLE IF NOT EXISTS drivers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id),
  license_number      text,
  license_state       char(2),
  license_expires_on  date,
  medical_expires_on  date,
  employee_code       text,
  work_rate_hourly    numeric(10,4) NOT NULL DEFAULT 25.00,
  drive_rate_hourly   numeric(10,4) NOT NULL DEFAULT 30.00,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Fleet
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  code                    text NOT NULL,
  name                    text,
  plate                   text,
  vin                     text,
  baseline_odometer_mi    numeric(12,3) NOT NULL DEFAULT 0,
  current_odometer_mi     numeric(12,3) NOT NULL DEFAULT 0,
  default_jurisdiction    char(2),
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS trackers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  vehicle_id        uuid NOT NULL REFERENCES vehicles(id),
  vendor            text NOT NULL DEFAULT 'custom',
  device_imei       text NOT NULL,
  api_external_id   text,
  last_seen_at      timestamptz,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, device_imei)
);

CREATE INDEX IF NOT EXISTS idx_trackers_vehicle ON trackers(vehicle_id);

-- ---------------------------------------------------------------------------
-- Telemetry (high volume)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
  id              bigserial PRIMARY KEY,
  company_id      uuid NOT NULL,
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  recorded_at     timestamptz NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  speed_mph       numeric(6,2),
  heading         numeric(5,1),
  odometer_mi     numeric(12,3),
  ignition_on     boolean,
  raw             jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_positions_vehicle_time
  ON positions (vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_company_time
  ON positions (company_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Work time & drive time
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  driver_id       uuid NOT NULL REFERENCES drivers(id),
  clock_in        timestamptz NOT NULL,
  clock_out       timestamptz,
  hours           numeric(8,3),
  start_odo_mi    numeric(12,3),
  end_odo_mi      numeric(12,3),
  odo_miles       numeric(12,3),
  gps_miles       numeric(12,3),
  status          session_status NOT NULL DEFAULT 'open',
  approved_at     timestamptz,
  approved_by     uuid REFERENCES users(id),
  submitted_at    timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_company_status
  ON work_sessions (company_id, status);
CREATE INDEX IF NOT EXISTS idx_work_sessions_driver_time
  ON work_sessions (driver_id, clock_in DESC);

CREATE TABLE IF NOT EXISTS drive_segments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  driver_id       uuid NOT NULL REFERENCES drivers(id),
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz,
  hours           numeric(8,3),
  gps_miles       numeric(12,3),
  odo_miles       numeric(12,3),
  start_odo_mi    numeric(12,3),
  end_odo_mi      numeric(12,3),
  start_lat       double precision,
  start_lng       double precision,
  end_lat         double precision,
  end_lng         double precision,
  jurisdiction    char(2),
  pay_category    text NOT NULL DEFAULT 'drive',
  status          text NOT NULL DEFAULT 'open',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drive_segments_vehicle_time
  ON drive_segments (vehicle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_segments_open
  ON drive_segments (vehicle_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS duty_status_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  driver_id       uuid NOT NULL REFERENCES drivers(id),
  vehicle_id      uuid REFERENCES vehicles(id),
  status          duty_status NOT NULL,
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz,
  source          text NOT NULL DEFAULT 'user',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_duty_driver_time
  ON duty_status_events (driver_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_duty_open
  ON duty_status_events (driver_id) WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- DVIR
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  vehicle_id        uuid NOT NULL REFERENCES vehicles(id),
  driver_id         uuid NOT NULL REFERENCES drivers(id),
  type              text NOT NULL CHECK (type IN ('pretrip', 'posttrip')),
  safe_to_operate   boolean NOT NULL,
  items             jsonb NOT NULL,
  notes             text,
  defect_count      int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_time
  ON inspections (vehicle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS defects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  inspection_id   uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  item_name       text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_defects_open
  ON defects (company_id) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- Expenses & integrity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  vehicle_id        uuid NOT NULL REFERENCES vehicles(id),
  driver_id         uuid REFERENCES drivers(id),
  type              text NOT NULL,
  amount            numeric(12,2) NOT NULL CHECK (amount >= 0),
  quantity          numeric(12,3),
  unit_price        numeric(12,4),
  vendor            text,
  payment_method    text,
  jurisdiction      char(2),
  odometer_mi       numeric(12,3),
  notes             text,
  receipt_url       text,
  purchased_at      date,
  logged_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_vehicle_time
  ON expenses (vehicle_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_fuel
  ON expenses (company_id, logged_at DESC) WHERE type = 'Fuel';

CREATE TABLE IF NOT EXISTS anomaly_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  vehicle_id      uuid REFERENCES vehicles(id),
  expense_id      uuid REFERENCES expenses(id),
  code            text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title           text NOT NULL,
  detail          text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'resolved')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_anomaly_open
  ON anomaly_flags (company_id) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- Jobs & geofences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geofences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  vehicle_id      uuid REFERENCES vehicles(id),
  name            text NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  radius_mi       numeric(8,3) NOT NULL DEFAULT 0.5,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_stops (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  address         text NOT NULL,
  sequence        int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'enroute', 'arrived', 'complete')),
  geofence_id     uuid REFERENCES geofences(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

-- ---------------------------------------------------------------------------
-- Payroll snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  week_start      date NOT NULL,
  week_end        date NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'exported')),
  exported_at     timestamptz,
  exported_by     uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, week_start)
);

CREATE TABLE IF NOT EXISTS pay_period_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id       uuid NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  driver_id           uuid NOT NULL REFERENCES drivers(id),
  work_hours          numeric(8,3) NOT NULL DEFAULT 0,
  drive_hours         numeric(8,3) NOT NULL DEFAULT 0,
  regular_hours       numeric(8,3) NOT NULL DEFAULT 0,
  ot15_hours          numeric(8,3) NOT NULL DEFAULT 0,
  ot20_hours          numeric(8,3) NOT NULL DEFAULT 0,
  regular_pay         numeric(12,2) NOT NULL DEFAULT 0,
  ot15_pay            numeric(12,2) NOT NULL DEFAULT 0,
  ot20_pay            numeric(12,2) NOT NULL DEFAULT 0,
  total_pay           numeric(12,2) NOT NULL DEFAULT 0,
  work_session_ids    uuid[] DEFAULT '{}',
  drive_segment_ids   uuid[] DEFAULT '{}',
  UNIQUE (pay_period_id, driver_id)
);

-- ---------------------------------------------------------------------------
-- Audit (append-only — revoke UPDATE/DELETE from app DB user in production)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id              bigserial PRIMARY KEY,
  company_id      uuid NOT NULL,
  actor_user_id   uuid,
  actor_name      text,
  action          text NOT NULL,
  entity_type     text,
  entity_id       text,
  vehicle_id      uuid,
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_company_time
  ON audit_events (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Seed helper comment (run separately with real password hashes)
-- ---------------------------------------------------------------------------
-- INSERT INTO companies (name, default_jurisdiction) VALUES ('Demo Rail LLC', 'TX');
-- INSERT INTO users (company_id, email, password_hash, name, role)
--   VALUES (...);

COMMENT ON TABLE drive_segments IS 'Paid drive time only (Start Drive / End Drive). Miles and hours here are paid at drive rate. Clocked-in driving/idling without Start Drive is tracked on work_sessions only and is NOT drive pay.';
COMMENT ON TABLE work_sessions IS 'Regular work hours at regular rate. odo_miles/gps_miles = miles while clocked in (tracked for ops; NOT paid as drive time). Requires approval before payroll';
COMMENT ON TABLE duty_status_events IS 'HOS assist only — not a certified ELD log unless certified';
COMMENT ON TABLE audit_events IS 'Append-only; do not grant UPDATE/DELETE to application role';

-- ---------------------------------------------------------------------------
-- Scheduled & predictive maintenance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  vehicle_id            uuid NOT NULL REFERENCES vehicles(id),
  service_type          text NOT NULL,
  description           text,
  interval_miles        numeric(12,1),
  interval_days         int,
  last_service_at       date,
  last_service_odo_mi   numeric(12,3),
  next_due_odo_mi       numeric(12,3),
  next_due_date         date,
  warn_miles_before     numeric(12,1) NOT NULL DEFAULT 500,
  warn_days_before      int NOT NULL DEFAULT 14,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maint_sched_vehicle
  ON maintenance_schedules (vehicle_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_maint_sched_company
  ON maintenance_schedules (company_id) WHERE active = true;

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  vehicle_id            uuid NOT NULL REFERENCES vehicles(id),
  schedule_id           uuid REFERENCES maintenance_schedules(id),
  service_type          text NOT NULL,
  performed_at          date NOT NULL,
  odometer_mi           numeric(12,3),
  cost                  numeric(12,2),
  vendor                text,
  notes                 text,
  performed_by          uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maint_logs_vehicle
  ON maintenance_logs (vehicle_id, performed_at DESC);

COMMENT ON TABLE maintenance_schedules IS 'Recurring service intervals by miles and/or days; due computed from vehicle odometer';
COMMENT ON TABLE maintenance_logs IS 'Completed service history; completing a service advances the schedule';

-- ---------------------------------------------------------------------------
-- Mobile / web push notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token           text NOT NULL,
  device_label    text,
  active          boolean NOT NULL DEFAULT true,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user
  ON device_tokens (user_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_device_tokens_company
  ON device_tokens (company_id) WHERE active = true;

CREATE TABLE IF NOT EXISTS notification_log (
  id              bigserial PRIMARY KEY,
  company_id      uuid NOT NULL,
  user_id         uuid,
  channel         text NOT NULL DEFAULT 'push',
  title           text NOT NULL,
  body            text,
  data            jsonb,
  status          text NOT NULL DEFAULT 'queued',
  provider        text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_user
  ON notification_log (user_id, created_at DESC);

COMMENT ON TABLE device_tokens IS 'FCM/APNs/web-push device tokens; provider chosen via NOTIFY_PROVIDER env';
COMMENT ON TABLE notification_log IS 'Outbound notification history for support and audit';
