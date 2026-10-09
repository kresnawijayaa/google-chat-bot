-- Run once in the Neon SQL Editor before deploying the bot.
-- Safe to rerun: existing tables and data are preserved.
CREATE TABLE IF NOT EXISTS bot_users (
  email TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_approvals (
  id TEXT PRIMARY KEY,
  approver_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'DECLINED')),
  data JSONB NOT NULL,
  CHECK (data->>'id' IS NOT NULL AND data->>'id' = id),
  CHECK (data->>'approverEmail' IS NOT NULL AND data->>'approverEmail' = approver_email),
  CHECK (data->>'status' IS NOT NULL AND data->>'status' = status)
);

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
