CREATE TABLE availability (
  singleton_id integer PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  time_zone text NOT NULL,
  weekly_slots jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO availability (singleton_id, time_zone, weekly_slots)
VALUES (
  1,
  'UTC',
  '[{"day":"mon","start":"09:00","end":"17:00"},{"day":"tue","start":"09:00","end":"17:00"},{"day":"wed","start":"09:00","end":"17:00"},{"day":"thu","start":"09:00","end":"17:00"},{"day":"fri","start":"09:00","end":"17:00"}]'::jsonb
);

CREATE TABLE appointments (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  service text NOT NULL,
  appointment_date date NOT NULL,
  appointment_time time NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  calendar_sync_status text NOT NULL DEFAULT 'not_queued'
    CHECK (calendar_sync_status IN ('not_queued', 'pending', 'synced', 'failed')),
  calendar_sync_error text,
  calendar_synced_at timestamptz,
  google_event_id text,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE INDEX appointments_status_date_idx
  ON appointments (status, appointment_date, appointment_time);

CREATE UNIQUE INDEX appointments_active_slot_unique_idx
  ON appointments (appointment_date, appointment_time)
  WHERE status IN ('pending', 'approved');

CREATE TABLE push_subscriptions (
  browser_id text PRIMARY KEY,
  endpoint text NOT NULL UNIQUE,
  keys jsonb NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_id_idx
  ON push_subscriptions (user_id);

CREATE TABLE calendar_outbox (
  id uuid PRIMARY KEY,
  appointment_id text NOT NULL REFERENCES appointments(id),
  action text NOT NULL DEFAULT 'create',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  google_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX calendar_outbox_due_idx
  ON calendar_outbox (status, next_attempt_at, created_at);

CREATE UNIQUE INDEX calendar_outbox_active_appointment_idx
  ON calendar_outbox (appointment_id)
  WHERE status IN ('pending', 'processing');