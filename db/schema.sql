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
