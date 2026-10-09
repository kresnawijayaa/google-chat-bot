-- Run in Neon SQL Editor BEFORE deploying the registration flow.
CREATE TABLE IF NOT EXISTS allowed_users (
  nik TEXT PRIMARY KEY CHECK (nik ~ '^[0-9]{1,32}$'),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  display_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS bot_registration_sessions (
  email TEXT PRIMARY KEY,
  dm_space TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bot_users_unique_nik ON bot_users ((data->>'nik')) WHERE data->>'nik' IS NOT NULL;

-- Add actual authorized employees, preserving leading zeros in NIK:
-- INSERT INTO allowed_users (nik, email, display_name)
-- VALUES ('00123456', 'nama@indomaret.com', 'Nama Karyawan')
-- ON CONFLICT (nik) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, enabled = TRUE;
