import { sql } from "drizzle-orm";
import { mysqlTable, int, varchar, text, datetime, boolean, uniqueIndex, index } from "drizzle-orm/mysql-core";

export const usersTable = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("open_id", { length: 191 }).notNull(),
  email: varchar("email", { length: 255 }),
  name: varchar("name", { length: 255 }),
  role: varchar("role", { length: 32 }).notNull().default("user"),
  createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`).$onUpdateFn(() => new Date()),
}, (table) => ({ openIdKey: uniqueIndex("users_open_id_key").on(table.openId) }));

export const sessionsTable = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
  createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ tokenKey: uniqueIndex("sessions_token_key").on(table.tokenHash), userIdx: index("sessions_user_idx").on(table.userId) }));

export const serversTable = mysqlTable("servers", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("owner_id"),
  name: varchar("name", { length: 191 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: int("port").notNull().default(22),
  username: varchar("username", { length: 191 }).notNull(),
  authType: varchar("auth_type", { length: 32 }).notNull().default("password"),
  password: text("password"),
  privateKey: text("private_key"),
  passphrase: text("passphrase"),
  status: varchar("status", { length: 32 }).notNull().default("unknown"),
  notes: text("notes"),
  createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime("updated_at", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`).$onUpdateFn(() => new Date()),
}, (table) => ({ ownerIdx: index("servers_owner_idx").on(table.ownerId) }));

export const cloudflareConnectionsTable = mysqlTable("cloudflare_connections", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("owner_id").notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  apiToken: text("api_token").notNull(),
  createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ ownerIdx: index("cf_owner_idx").on(table.ownerId) }));

export const dnsZonesTable = mysqlTable("dns_zones", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("owner_id").notNull(),
  connectionId: int("connection_id").notNull(),
  zoneId: varchar("zone_id", { length: 191 }).notNull(),
  zoneName: varchar("zone_name", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ ownerZoneKey: uniqueIndex("dns_zone_owner_key").on(table.ownerId, table.zoneId), connectionIdx: index("dns_zone_connection_idx").on(table.connectionId) }));

export const siteLinksTable = mysqlTable("site_links", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("owner_id").notNull(),
  serverId: int("server_id").notNull(),
  zoneId: int("zone_id").notNull(),
  hostname: varchar("hostname", { length: 255 }).notNull(),
  port: int("port").notNull(),
  proxied: boolean("proxied").notNull().default(false),
  createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ uniqueHost: uniqueIndex("site_link_unique").on(table.ownerId, table.hostname), serverIdx: index("site_links_server_idx").on(table.serverId) }));

export const auditLogsTable = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("owner_id").notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  targetType: varchar("target_type", { length: 64 }).notNull(),
  targetId: varchar("target_id", { length: 191 }),
  status: varchar("status", { length: 32 }).notNull(),
  metadata: text("metadata"),
  createdAt: datetime("created_at", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ ownerIdx: index("audit_owner_idx").on(table.ownerId), createdIdx: index("audit_created_idx").on(table.createdAt) }));
