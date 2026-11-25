import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { beginOAuth, clearOAuthCookie, completeOAuth, createSession, currentUser, destroySession, authenticateApiKey, revokeOtherSessions, setSessionCookie } from "../security/session";
import { checkLoginBlock, recordLoginFailure, resetLoginRateLimit } from "../security/login-rate-limit";
import { isAdminIpAllowed, isTrustedBrowserOrigin } from "../middleware/auth";
import { setApiKey } from "../key-store";
import { audit } from "../security/audit";
import { logger } from "../lib/logger";
import { pool } from "@workspace/db";
import {
  clearMfaChallenge, consumeMfaChallenge, createMfaChallenge, createMfaSetup, disableMfa,
  enableMfa, getMfaChallenge, isMfaEnabled, recordMfaChallengeFailure, verifyMfaCode,
} from "../security/mfa";

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

router.get("/auth/login", checkLoginBlock, (req, res) => {
  if (rejectIp(req, res)) return;
  beginOAuth(req, res);
});
router.get("/auth/callback", checkLoginBlock, async (req, res) => {
  if (rejectIp(req, res)) { res.end(); return; }
  try {
    const user = await completeOAuth(req);
    clearOAuthCookie(res);
    if (await isMfaEnabled(user.id)) {
      await createMfaChallenge(user.id, res);
      res.redirect("/login?mfa=1");
      return;
    }
    setSessionCookie(res, await createSession(user), 30 * 86400);
    await resetLoginRateLimit(req);
    res.redirect("/");
  } catch {
    clearOAuthCookie(res);
    try {
      const failure = await recordLoginFailure(req);
      if (failure.blocked) {
        res.setHeader("Retry-After", String(failure.retryAfterSeconds));
        res.redirect(429, "/login?error=rate_limited");
      } else res.redirect("/login?error=authentication_failed");
    } catch {
      res.status(503).json({ error: "Sign-in protection is temporarily unavailable" });
    }
  }
});

router.post("/auth/key-login", checkLoginBlock, async (req, res) => {
  if (rejectIp(req, res) || rejectOrigin(req, res)) return;
  try {
    const user = await authenticateApiKey(req);
    if (!user || user.role !== "admin") {
      logger.warn({ ip: req.ip }, "Administrator key login failed");
      let failure: Awaited<ReturnType<typeof recordLoginFailure>>;
      try { failure = await recordLoginFailure(req); }
      catch {
        res.status(503).json({ error: "Sign-in protection is temporarily unavailable" });
        return;
      }
      if (failure.blocked) {
        res.setHeader("Retry-After", String(failure.retryAfterSeconds));
        res.status(429).json({ error: "Too many failed sign-in attempts. Try again in 15 minutes." });
      } else res.status(401).json({ error: "Invalid access key" });
      return;
    }
    if (await isMfaEnabled(user.id)) {
      await createMfaChallenge(user.id, res);
      res.setHeader("Cache-Control", "no-store");
      res.json({ mfaRequired: true });
      return;
    }
    setSessionCookie(res, await createSession(user), 30 * 86400);
    await resetLoginRateLimit(req);
    (req as any).user = user;
    await audit(req, "auth.key_login", "user", user.id, "success").catch(() => undefined);
    res.setHeader("Cache-Control", "no-store");
    res.json({ user });
  } catch {
    res.status(503).json({ error: "Could not create an authenticated session" });
  }
});

router.get("/auth/mfa/status", async (req, res) => {
  if (rejectIp(req, res)) return;
  const user = await currentUser(req);
  if (!user || user.role !== "admin") { res.status(401).json({ error: "Not signed in" }); return; }
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ enabled: await isMfaEnabled(user.id) });
  } catch {
    res.status(503).json({ error: "Could not load multi-factor status" });
  }
});

router.post("/auth/mfa/setup", async (req, res) => {
  if (!cookieAuth(req)) { res.status(401).json({ error: "Not signed in" }); return; }
  if (rejectOrigin(req, res) || rejectIp(req, res)) return;
  const user = await currentUser(req);
  if (!user || user.role !== "admin") { res.status(401).json({ error: "Not signed in" }); return; }
  try {
    if (await isMfaEnabled(user.id)) { res.status(409).json({ error: "Multi-factor authentication is already enabled" }); return; }
    const setup = await createMfaSetup(user.id, user.email ?? user.name ?? `admin-${user.id}`);
    if (!setup) { res.status(409).json({ error: "Multi-factor authentication is already enabled" }); return; }
    res.setHeader("Cache-Control", "no-store");
    res.json(setup);
  } catch {
    res.status(503).json({ error: "Could not start multi-factor setup" });
  }
});

router.post("/auth/mfa/enable", async (req, res) => {
  if (!cookieAuth(req)) { res.status(401).json({ error: "Not signed in" }); return; }
  if (rejectOrigin(req, res) || rejectIp(req, res)) return;
  const user = await currentUser(req);
  if (!user || user.role !== "admin") { res.status(401).json({ error: "Not signed in" }); return; }
  const code = typeof req.body?.code === "string" ? req.body.code.slice(0, 100) : "";
  try {
    const recoveryCodes = await enableMfa(user.id, code);
    if (!recoveryCodes) { res.status(400).json({ error: "The code is invalid or setup has expired" }); return; }
    let sessionRevocationWarning: string | undefined;
    try { await revokeOtherSessions(req, user.id); }
    catch {
      sessionRevocationWarning = "MFA is enabled, but some existing browser sessions could not be revoked.";
      logger.error({ userId: user.id }, "Could not revoke existing sessions after enabling MFA");
    }
    (req as any).user = user;
    await audit(req, "auth.mfa.enable", "user", user.id, "success").catch(() => undefined);
    res.setHeader("Cache-Control", "no-store");
    res.json({ recoveryCodes, warning: sessionRevocationWarning });
  } catch {
    res.status(503).json({ error: "Could not enable multi-factor authentication" });
  }
});

router.post("/auth/mfa/disable", async (req, res) => {
  if (!cookieAuth(req)) { res.status(401).json({ error: "Not signed in" }); return; }
  if (rejectOrigin(req, res) || rejectIp(req, res)) return;
  const user = await currentUser(req);
  if (!user || user.role !== "admin") { res.status(401).json({ error: "Not signed in" }); return; }
  const code = typeof req.body?.code === "string" ? req.body.code.slice(0, 100) : "";
  try {
    if (!await disableMfa(user.id, code)) { res.status(400).json({ error: "The authenticator or recovery code is invalid" }); return; }
    (req as any).user = user;
    await audit(req, "auth.mfa.disable", "user", user.id, "success").catch(() => undefined);
    res.json({ ok: true });
  } catch {
    res.status(503).json({ error: "Could not disable multi-factor authentication" });
  }
});

router.post("/auth/mfa/verify", checkLoginBlock, async (req, res) => {
  if (rejectIp(req, res) || rejectOrigin(req, res)) return;
  const challenge = await getMfaChallenge(req);
  if (!challenge) { clearMfaChallenge(res); res.status(401).json({ error: "The sign-in challenge expired. Sign in again." }); return; }
  const code = typeof req.body?.code === "string" ? req.body.code.slice(0, 100) : "";
  try {
    const valid = await isMfaEnabled(challenge.userId) && await verifyMfaCode(challenge.userId, code);
    if (!valid) {
      const attempts = await recordMfaChallengeFailure(challenge.tokenHash);
      let failure: Awaited<ReturnType<typeof recordLoginFailure>>;
      try { failure = await recordLoginFailure(req); }
      catch { res.status(503).json({ error: "Sign-in protection is temporarily unavailable" }); return; }
      if (failure.blocked) {
        clearMfaChallenge(res);
        res.setHeader("Retry-After", String(failure.retryAfterSeconds));
        res.status(429).json({ error: "Too many failed sign-in attempts. Try again in 15 minutes." });
      } else if (attempts >= 5) {
        clearMfaChallenge(res);
        res.status(401).json({ error: "Too many invalid codes. Sign in again." });
      } else res.status(401).json({ error: "Invalid authenticator or recovery code" });
      return;
    }
    if (!await consumeMfaChallenge(challenge.tokenHash)) {
      clearMfaChallenge(res);
      res.status(401).json({ error: "The sign-in challenge expired or was already used" });
      return;
    }
    const [users] = await pool.query<any[]>(
      `SELECT id, open_id AS openId, email, name, role FROM users WHERE id=? LIMIT 1`,
      [challenge.userId],
    );
    const user = users[0];
    if (!user || user.role !== "admin") { clearMfaChallenge(res); res.status(401).json({ error: "Administrator account is unavailable" }); return; }
    setSessionCookie(res, await createSession(user), 30 * 86400);
    clearMfaChallenge(res);
    await resetLoginRateLimit(req);
    (req as any).user = user;
    await audit(req, "auth.mfa.challenge", "user", user.id, "success").catch(() => undefined);
    res.setHeader("Cache-Control", "no-store");
    res.json({ user });
  } catch {
    res.status(503).json({ error: "Could not complete multi-factor sign-in" });
  }
});

router.get("/auth/security-events", async (req, res) => {
  if (rejectIp(req, res)) return;
  const user = await currentUser(req);
  if (!user || user.role !== "admin") { res.status(401).json({ error: "Not signed in" }); return; }
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
  try {
    await pool.execute(`DELETE FROM auth_security_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`);
    const [events] = await pool.query<any[]>(
      `SELECT id, source_ip AS sourceIp, failed_attempts AS failedAttempts, created_at AS createdAt
       FROM auth_security_events ORDER BY created_at DESC LIMIT ${limit}`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ events });
  } catch {
    res.status(503).json({ error: "Could not load security events" });
  }
});

router.get("/auth/verify", async (req, res) => {
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
