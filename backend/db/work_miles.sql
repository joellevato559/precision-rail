-- Miles while clocked in (ops tracking only — not drive pay)
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS gps_miles numeric(12,3);

COMMENT ON TABLE work_sessions IS 'Regular work hours at regular rate. odo_miles/gps_miles = miles while clocked in (tracked for ops; NOT paid as drive time).';
COMMENT ON COLUMN work_sessions.odo_miles IS 'Odometer miles while clocked in. Not paid as drive time.';
COMMENT ON COLUMN work_sessions.gps_miles IS 'GPS path miles while clocked in. Not paid as drive time.';
COMMENT ON TABLE drive_segments IS 'Paid drive time only (Start Drive / End Drive). Hours and miles here use drive rate.';
