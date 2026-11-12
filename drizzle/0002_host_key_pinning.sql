-- Add user-confirmed SSH host-key pinning for saved VPS connections.
ALTER TABLE servers ADD COLUMN host_fingerprint VARCHAR(128) NULL;
ALTER TABLE servers ADD COLUMN pending_host_fingerprint VARCHAR(128) NULL;
