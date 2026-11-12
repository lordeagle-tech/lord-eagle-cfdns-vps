import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";

export interface AppUser { id: number; openId: string; email: string | null; name: string | null; role: string; }
const SESSION_COOKIE = "webdev_app_session";
const OAUTH_COOKIE = "cfdns_oauth_nonce";
const SESSION_DAYS = 30;

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function cookieValue(req: Request, name: string): string | null {
  for (const piece of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = piece.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
function publicOrigin(req: Request): string {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0];
  const host = String(req.headers["x-forwarded-host"] ?? req.get("host") ?? "localhost").split(",")[0];
  return `${proto}://${host}`;
}
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function setSessionCookie(res: Response, value: string, maxAgeSeconds: number): void {
  res.cookie(SESSION_COOKIE, value, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: maxAgeSeconds * 1000 });
}
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "none", path: "/" });
}
async function upsertUser(identity: { openId: string; email?: string | null; name?: string | null }): Promise<AppUser> {
  await pool.execute(`INSERT INTO users (open_id, email, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE email=VALUES(email), name=VALUES(name), updated_at=CURRENT_TIMESTAMP`, [identity.openId, identity.email ?? null, identity.name ?? null]);
  const [rows] = await pool.query<any[]>(`SELECT id, open_id AS openId, email, name, role FROM users WHERE open_id = ? LIMIT 1`, [identity.openId]);
  return rows[0] as AppUser;
}
export async function createSession(user: AppUser): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await pool.execute(`DELETE FROM sessions WHERE expires_at < NOW() OR user_id = ?`, [user.id]);
  await pool.execute(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)`, [user.id, hash(token), expiresAt]);
  return token;
}
export async function currentUser(req: Request): Promise<AppUser | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) {
    const [rows] = await pool.query<any[]>(`SELECT u.id, u.open_id AS openId, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > NOW() LIMIT 1`, [hash(token)]);
    if (rows[0]) return rows[0] as AppUser;
  }
  const auth = req.headers.authorization ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const configured = process.env.API_KEY ?? "";
  if (bearer && configured && safeEqual(bearer, configured)) return upsertUser({ openId: "local-api-key-owner", name: "Local owner" });
  return null;
}
export function beginOAuth(req: Request, res: Response): void {
  const portal = process.env.MANUS_OAUTH_PORTAL_URL; const appId = process.env.MANUS_PROJECT_ID;
  if (!portal || !appId) { res.redirect("/login?error=oauth_unavailable"); return; }
  const nonce = randomBytes(24).toString("hex");
  const redirectUri = `${publicOrigin(req)}/api/auth/callback`;
  const state = Buffer.from(JSON.stringify({ redirectUri, nonce })).toString("base64url");
  res.cookie(OAUTH_COOKIE, nonce, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 600_000 });
  const url = new URL(`${portal.replace(/\/$/, "")}/app-auth`);
  url.searchParams.set("appId", appId); url.searchParams.set("redirectUri", redirectUri); url.searchParams.set("state", state); url.searchParams.set("responseType", "code");
  res.redirect(url.toString());
}
export async function completeOAuth(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const nonce = cookieValue(req, OAUTH_COOKIE);
  if (!code || !state || !nonce) throw new Error("OAuth state is missing or expired");
  const payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { redirectUri?: string; nonce?: string };
  if (!payload.redirectUri || !payload.nonce || !safeEqual(payload.nonce, nonce)) throw new Error("OAuth state validation failed");
  const api = process.env.MANUS_OAUTH_API_URL; const clientId = process.env.MANUS_PROJECT_ID;
  if (!api || !clientId) throw new Error("OAuth is not configured");
  const exchange = await fetch(`${api.replace(/\/$/, "")}/webdev.v1.WebDevAuthPublicService/ExchangeToken`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, grantType: "authorization_code", code, redirectUri: payload.redirectUri }) });
  if (!exchange.ok) throw new Error("OAuth token exchange failed");
  const token = await exchange.json() as { accessToken?: string };
  if (!token.accessToken) throw new Error("OAuth did not return an access token");
  const info = await fetch(`${api.replace(/\/$/, "")}/webdev.v1.WebDevAuthPublicService/GetUserInfo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: token.accessToken }) });
  if (!info.ok) throw new Error("OAuth identity lookup failed");
  const identity = await info.json() as { openId?: string; email?: string; name?: string };
  if (!identity.openId) throw new Error("OAuth identity is missing an account id");
  const session = await createSession(await upsertUser({ openId: identity.openId, email: identity.email, name: identity.name }));
  setSessionCookie(res, session, SESSION_DAYS * 86400);
  res.clearCookie(OAUTH_COOKIE, { httpOnly: true, secure: true, sameSite: "none", path: "/" });
  res.redirect("/");
}
export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) await pool.execute(`DELETE FROM sessions WHERE token_hash=?`, [hash(token)]);
  clearSessionCookie(res);
}
