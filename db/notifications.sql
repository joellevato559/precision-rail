-- Apply on existing DBs: psql -d precision_rail -f db/notifications.sql

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
