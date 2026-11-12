import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? process.env.DRIZZLE_DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const pool = mysql.createPool(connectionString);
export const db = drizzle(pool, { schema, mode: "default" });

export async function ensureDatabase(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, open_id VARCHAR(191) NOT NULL UNIQUE, email VARCHAR(255), name VARCHAR(255), role VARCHAR(32) NOT NULL DEFAULT 'user', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS sessions (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, token_hash VARCHAR(128) NOT NULL UNIQUE, expires_at DATETIME NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX sessions_user_idx (user_id))`,
    `CREATE TABLE IF NOT EXISTS servers (id INT AUTO_INCREMENT PRIMARY KEY, owner_id INT, name VARCHAR(191) NOT NULL, host VARCHAR(255) NOT NULL, port INT NOT NULL DEFAULT 22, username VARCHAR(191) NOT NULL, auth_type VARCHAR(32) NOT NULL DEFAULT 'password', password TEXT, private_key TEXT, passphrase TEXT, host_fingerprint VARCHAR(128), pending_host_fingerprint VARCHAR(128), status VARCHAR(32) NOT NULL DEFAULT 'unknown', notes TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX servers_owner_idx (owner_id))`,
    `CREATE TABLE IF NOT EXISTS cloudflare_connections (id INT AUTO_INCREMENT PRIMARY KEY, owner_id INT NOT NULL, name VARCHAR(191) NOT NULL, api_token TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX cf_owner_idx (owner_id))`,
    `CREATE TABLE IF NOT EXISTS dns_zones (id INT AUTO_INCREMENT PRIMARY KEY, owner_id INT NOT NULL, connection_id INT NOT NULL, zone_id VARCHAR(191) NOT NULL, zone_name VARCHAR(255) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'active', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY dns_zone_owner_key (owner_id, zone_id), INDEX dns_zone_connection_idx (connection_id))`,
    `CREATE TABLE IF NOT EXISTS site_links (id INT AUTO_INCREMENT PRIMARY KEY, owner_id INT NOT NULL, server_id INT NOT NULL, zone_id INT NOT NULL, hostname VARCHAR(255) NOT NULL, port INT NOT NULL, proxied BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY site_link_unique (owner_id, hostname), INDEX site_links_server_idx (server_id))`,
    `CREATE TABLE IF NOT EXISTS audit_logs (id INT AUTO_INCREMENT PRIMARY KEY, owner_id INT NOT NULL, action VARCHAR(128) NOT NULL, target_type VARCHAR(64) NOT NULL, target_id VARCHAR(191), status VARCHAR(32) NOT NULL, metadata TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX audit_owner_idx (owner_id), INDEX audit_created_idx (created_at))`,
    `CREATE TABLE IF NOT EXISTS auth_rate_limits (bucket_key VARCHAR(191) PRIMARY KEY, window_started_at DATETIME NOT NULL, attempts INT NOT NULL DEFAULT 0, blocked_until DATETIME NULL, INDEX auth_rate_expiry_idx (window_started_at))`,
  ];
  for (const statement of statements) await pool.query(statement);
  for (const column of ["host_fingerprint", "pending_host_fingerprint"]) {
    try {
      await pool.query(`ALTER TABLE servers ADD COLUMN ${column} VARCHAR(128) NULL`);
    } catch (error: any) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

export * from "./schema";
