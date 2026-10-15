-- Jalankan sekali di database Neon yang dipakai DATABASE_URL gchat-training.
CREATE TABLE IF NOT EXISTS gchat_training_allowed_users (
  email TEXT PRIMARY KEY
    CHECK (email = lower(btrim(email)) AND email <> '')
);

INSERT INTO gchat_training_allowed_users (email)
VALUES ('kresnawijaya511@indomaret.com')
ON CONFLICT (email) DO NOTHING;
