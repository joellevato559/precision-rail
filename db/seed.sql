-- Demo seed for Precision Rail
-- Password for all users: password123
-- Run after schema.sql:
--   psql -d precision_rail -f db/seed.sql

BEGIN;

-- Clean demo rows if re-seeding (safe for empty DB)
TRUNCATE audit_events, pay_period_lines, pay_periods, anomaly_flags, expenses,
  maintenance_logs, maintenance_schedules,
  defects, inspections, job_stops, geofences, duty_status_events, drive_segments,
  work_sessions, positions, trackers, drivers, vehicles, refresh_tokens, users, companies
  CASCADE;

INSERT INTO companies (
  id, name, timezone, require_pretrip, pretrip_max_age_hours,
  allow_pretrip_override, hos_assist_enabled, default_jurisdiction
) VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'Demo Rail LLC',
  'America/Chicago',
  true,
  12,
  true,
  true,
  'TX'
);

-- password123
INSERT INTO users (id, company_id, email, password_hash, name, role) VALUES
  ('b0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001',
   'admin@demo.rail',
   '$2b$10$Y2X7fWMImqFWHltZ8W0MgOpgcjI6PUG1jr0JH/xHSRSHhGHnUr5iO',
   'Sara Admin', 'admin'),
  ('b0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000001',
   'manager@demo.rail',
   '$2b$10$Y2X7fWMImqFWHltZ8W0MgOpgcjI6PUG1jr0JH/xHSRSHhGHnUr5iO',
   'Mike Manager', 'manager'),
  ('b0000000-0000-4000-8000-000000000003',
   'a0000000-0000-4000-8000-000000000001',
   'driver@demo.rail',
   '$2b$10$Y2X7fWMImqFWHltZ8W0MgOpgcjI6PUG1jr0JH/xHSRSHhGHnUr5iO',
   'John Driver', 'driver');

INSERT INTO drivers (id, user_id, company_id, license_number, license_state, employee_code, work_rate_hourly, drive_rate_hourly) VALUES
  ('c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000003',
   'a0000000-0000-4000-8000-000000000001',
   'D1234567', 'TX', 'EMP-100', 25.00, 30.00);

INSERT INTO vehicles (id, company_id, code, name, plate, baseline_odometer_mi, current_odometer_mi, default_jurisdiction) VALUES
  ('d0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001',
   'TRUCK-01', 'Primary Unit', 'ABC-1234', 14500.000, 14500.000, 'TX'),
  ('d0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000001',
   'TRUCK-02', 'Secondary Unit', 'XYZ-7890', 8200.000, 8200.000, 'TX');

INSERT INTO trackers (id, company_id, vehicle_id, vendor, device_imei, last_seen_at) VALUES
  ('e0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   'custom', '359632105847291', now()),
  ('e0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000002',
   'custom', '359632105847292', now() - interval '2 hours');

-- Sample position near Dallas so the live map has a pin
INSERT INTO positions (company_id, vehicle_id, recorded_at, lat, lng, speed_mph, odometer_mi, ignition_on) VALUES
  ('a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   now() - interval '2 minutes',
   32.7767, -96.7970, 0, 14500.000, true),
  ('a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000002',
   now() - interval '2 hours',
   32.7555, -97.3308, 0, 8200.000, false);


-- Scheduled maintenance (demo)
INSERT INTO maintenance_schedules (
  id, company_id, vehicle_id, service_type, description,
  interval_miles, interval_days, last_service_at, last_service_odo_mi,
  next_due_odo_mi, next_due_date, warn_miles_before, warn_days_before
) VALUES
  ('f0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   'Oil Change', 'Engine oil and filter',
   5000, 180, CURRENT_DATE - 160, 10000.000,
   15000.000, CURRENT_DATE + 20, 500, 14),
  ('f0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   'Tire Rotation', 'Rotate and inspect tread',
   8000, NULL, CURRENT_DATE - 90, 7000.000,
   15000.000, NULL, 500, 14),
  ('f0000000-0000-4000-8000-000000000003',
   'a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   'DOT Inspection', 'Annual safety inspection',
   NULL, 365, CURRENT_DATE - 340, 12000.000,
   NULL, CURRENT_DATE + 25, 500, 30),
  ('f0000000-0000-4000-8000-000000000004',
   'a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000002',
   'Oil Change', 'Engine oil and filter',
   5000, 180, CURRENT_DATE - 200, 4000.000,
   9000.000, CURRENT_DATE - 10, 500, 14);

INSERT INTO duty_status_events (company_id, driver_id, vehicle_id, status, started_at, source) VALUES
  ('a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   'off', now() - interval '1 day', 'system');

COMMIT;

-- Login:
--   driver@demo.rail  / password123
--   manager@demo.rail / password123
--   admin@demo.rail   / password123
