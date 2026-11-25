CREATE TABLE IF NOT EXISTS auth_security_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_ip VARCHAR(120) NOT NULL,
  failed_attempts INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX auth_security_created_idx (created_at)
);

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id INT PRIMARY KEY,
  secret_encrypted TEXT NOT NULL,
  enabled_at DATETIME NULL,
  recovery_codes TEXT NULL,
  pending_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX auth_mfa_expiry_idx (expires_at)
);
