import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { beginOAuth, completeOAuth, currentUser, destroySession, loginWithApiKey, revokeOtherSessions } from "../security/session";
import { loginRateLimit, resetLoginRateLimit } from "../security/login-rate-limit";
import { isAdminIpAllowed, isTrustedBrowserOrigin } from "../middleware/auth";
import { setApiKey } from "../key-store";
import { audit } from "../security/audit";
import { logger } from "../lib/logger";

const router = Router();
const cookieAuth = (req: Request) => (req.headers.cookie ?? "").split(";").some((part) => part.trim().startsWith("webdev_app_session="));
function rejectOrigin(req: Request, res: Response): boolean {
  if (!isTrustedBrowserOrigin(req)) { res.status(403).json({ error: "Request origin is not allowed" }); return true; }
  return false;
}
function rejectIp(req: Request, res: Response): boolean {
  if (!isAdminIpAllowed(req)) { res.status(403).json({ error: "Administrator access is not available from this network" }); return true; }
  return false;
}

router.get("/auth/login", loginRateLimit, (req, res) => {
  if (rejectIp(req, res)) return;
  beginOAuth(req, res);
});
router.get("/auth/callback", loginRateLimit, async (req, res) => {
  if (rejectIp(req, res)) { res.end(); return; }
  try {
    await completeOAuth(req, res);
    await resetLoginRateLimit(req).catch(() => undefined);
  } catch {
    res.redirect("/login?error=authentication_failed");
  }
});

router.post("/auth/key-login", loginRateLimit, async (req, res) => {
  if (rejectIp(req, res) || rejectOrigin(req, res)) return;
  try {
    const user = await loginWithApiKey(req, res);
    if (!user || user.role !== "admin") {
      logger.warn({ ip: req.ip }, "Administrator key login failed");
      res.status(401).json({ error: "Invalid access key" });
      return;
    }
    await resetLoginRateLimit(req);
    (req as any).user = user;
    await audit(req, "auth.key_login", "user", user.id, "success").catch(() => undefined);
    res.setHeader("Cache-Control", "no-store");
    res.json({ user });
  } catch {
    res.status(503).json({ error: "Could not create an authenticated session" });
  }
});

router.get("/auth/verify", loginRateLimit, async (req, res) => {
  if (rejectIp(req, res)) return;
  const user = await currentUser(req);
  if (!user || user.role !== "admin") { res.status(401).json({ error: "Not signed in" }); return; }
  res.json({ ok: true, user });
});

router.get("/auth/me", async (req, res) => {
  if (rejectIp(req, res)) return;
  const user = await currentUser(req);
  if (!user || user.role !== "admin") { res.status(401).json({ error: "Not signed in" }); return; }
  res.json({ user });
});

router.post("/auth/sessions/revoke-others", async (req, res) => {
  if (!cookieAuth(req)) { res.status(401).json({ error: "Not signed in" }); return; }
  if (rejectOrigin(req, res) || rejectIp(req, res)) return;
  const user = await currentUser(req);
  if (!user || user.role !== "admin") { res.status(401).json({ error: "Not signed in" }); return; }
  try {
    await revokeOtherSessions(req, user.id);
    (req as any).user = user;
    await audit(req, "auth.sessions.revoke_others", "user", user.id, "success");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ error: "Could not revoke other sessions" });
  }
});

router.post("/auth/rotate-key", async (req, res) => {
  if (!cookieAuth(req)) { res.status(401).json({ error: "Not signed in" }); return; }
  if (rejectOrigin(req, res) || rejectIp(req, res)) return;
  const user = await currentUser(req);
  if (!user || user.role !== "admin") { res.status(401).json({ error: "Not signed in" }); return; }
  try {
    const nextKey = randomBytes(32).toString("hex");
    await revokeOtherSessions(req, user.id);
    setApiKey(nextKey);
    (req as any).user = user;
    await audit(req, "auth.api_key.rotate", "user", user.id, "success").catch(() => undefined);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.json({ apiKey: nextKey, message: "Copy this key now; it will not be shown again. Other browser sessions were revoked." });
  } catch {
    res.status(503).json({ error: "Could not rotate the access key" });
  }
});

router.post("/auth/logout", async (req, res) => {
  if (cookieAuth(req) && rejectOrigin(req, res)) return;
  await destroySession(req, res);
  res.json({ ok: true });
});

export default router;
