-- Durable administrator sign-in throttling shared across app processes.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_key VARCHAR(191) NOT NULL PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  blocked_until DATETIME NULL,
  INDEX auth_rate_expiry_idx (window_started_at)
);
