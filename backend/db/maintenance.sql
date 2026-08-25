-- Apply on existing databases that already ran schema.sql
-- psql -d precision_rail -f db/maintenance.sql

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
