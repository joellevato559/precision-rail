-- Pay rates + OT columns
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS work_rate_hourly numeric(10,4) NOT NULL DEFAULT 25.00;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS drive_rate_hourly numeric(10,4) NOT NULL DEFAULT 30.00;

ALTER TABLE pay_period_lines ADD COLUMN IF NOT EXISTS regular_hours numeric(8,3) NOT NULL DEFAULT 0;
ALTER TABLE pay_period_lines ADD COLUMN IF NOT EXISTS ot15_hours numeric(8,3) NOT NULL DEFAULT 0;
ALTER TABLE pay_period_lines ADD COLUMN IF NOT EXISTS ot20_hours numeric(8,3) NOT NULL DEFAULT 0;
ALTER TABLE pay_period_lines ADD COLUMN IF NOT EXISTS regular_pay numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE pay_period_lines ADD COLUMN IF NOT EXISTS ot15_pay numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE pay_period_lines ADD COLUMN IF NOT EXISTS ot20_pay numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE pay_period_lines ADD COLUMN IF NOT EXISTS total_pay numeric(12,2) NOT NULL DEFAULT 0;
