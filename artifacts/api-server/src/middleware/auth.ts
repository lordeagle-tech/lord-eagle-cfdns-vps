import type { Request, Response, NextFunction } from "express";
import { isIP } from "node:net";
import { currentUser, type AppUser } from "../security/session";

declare global {
  namespace Express {
    interface Request { user?: AppUser }
  }
}

const SESSION_COOKIE = "webdev_app_session";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function configuredOrigins(): Set<string> {
  const raw = [process.env.APP_ORIGIN ?? "", process.env.APP_ALLOWED_ORIGINS ?? ""].join(",");
  const origins = new Set<string>();
  for (const value of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    try { origins.add(new URL(value).origin); } catch { /* ignore invalid deployment values */ }
  }
  return origins;
}

export function isTrustedBrowserOrigin(req: Request): boolean {
  const rawOrigin = req.get("origin");
  if (!rawOrigin) return false;
  let origin: string;
  try { origin = new URL(rawOrigin).origin; } catch { return false; }

  const allowed = configuredOrigins();
  if (allowed.size > 0) return allowed.has(origin);

  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.get("host") ?? "").split(",")[0].trim();
  return Boolean(host) && origin === `${proto}://${host}`;
}

export function isAdminIpAllowed(req: Request): boolean {
  const entries = (process.env.ADMIN_IP_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (entries.length === 0) return true;
  const address = (req.ip ?? req.socket.remoteAddress ?? "").replace(/^::ffff:/i, "").toLowerCase();
  return isIP(address) !== 0 && entries.some((entry) => {
    const normalized = entry.replace(/^::ffff:/i, "").toLowerCase();
    return isIP(normalized) !== 0 && normalized === address;
  });
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await currentUser(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!isAdminIpAllowed(req)) {
      res.status(403).json({ error: "Administrator access is not available from this network" });
      return;
    }
    req.user = user;

    const cookieAuth = (req.headers.cookie ?? "").split(";").some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
    if (cookieAuth && MUTATING_METHODS.has(req.method.toUpperCase()) && !isTrustedBrowserOrigin(req)) {
      res.status(403).json({ error: "Request origin is not allowed" });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: "Authentication service unavailable" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
}
