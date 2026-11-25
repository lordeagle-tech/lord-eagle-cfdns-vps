import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";

const ATTEMPT_WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 3;
let calls = 0;

function bucket(req: Request): string {
  const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/i, "").slice(0, 120);
  return `login-failed:${ip}`;
}

function blockedResponse(req: Request, res: Response, retryAfterSeconds: number): void {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  if (req.method === "GET" && req.accepts("html")) {
    res.redirect(303, "/login?error=rate_limited");
    return;
  }
  res.status(429).json({ error: "Too many failed sign-in attempts. Try again in 15 minutes." });
}

export async function resetLoginRateLimit(req: Request): Promise<void> {
  await pool.execute(`DELETE FROM auth_rate_limits WHERE bucket_key=?`, [bucket(req)]);
}

/** Persistent, shared lockout check. Fail closed if its backing store is unavailable. */
export async function checkLoginBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const key = bucket(req);
    const [rows] = await pool.query<any[]>(
      `SELECT GREATEST(TIMESTAMPDIFF(SECOND, NOW(), blocked_until), 0) AS retry_after
       FROM auth_rate_limits WHERE bucket_key=? LIMIT 1`,
      [key],
    );
    const retryAfterSeconds = Number(rows[0]?.retry_after ?? 0);
    if (retryAfterSeconds > 0) {
      blockedResponse(req, res, retryAfterSeconds);
      return;
    }

    await pool.execute(
      `DELETE FROM auth_rate_limits
       WHERE bucket_key=? AND (
         blocked_until <= NOW() OR
         (blocked_until IS NULL AND window_started_at < DATE_SUB(NOW(), INTERVAL ${ATTEMPT_WINDOW_MINUTES} MINUTE)
         )
       )`,
      [key],
    );
    if (++calls % 100 === 0) {
      void pool.query(
        `DELETE FROM auth_rate_limits
         WHERE window_started_at < DATE_SUB(NOW(), INTERVAL 2 HOUR) AND (blocked_until IS NULL OR blocked_until <= NOW())`,
      ).catch(() => undefined);
    }
    next();
  } catch {
    res.status(503).json({ error: "Sign-in protection is temporarily unavailable" });
  }
}

/** Count only an actual invalid sign-in, and lock the source IP after the third failure. */
export async function recordLoginFailure(req: Request): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  const key = bucket(req);
  await pool.execute(
    `INSERT INTO auth_rate_limits (bucket_key, window_started_at, attempts, blocked_until)
     VALUES (?, NOW(), 1, NULL)
     ON DUPLICATE KEY UPDATE
       blocked_until=IF(window_started_at < DATE_SUB(NOW(), INTERVAL ${ATTEMPT_WINDOW_MINUTES} MINUTE), NULL, blocked_until),
       attempts=IF(blocked_until > NOW(), attempts,
         IF(window_started_at < DATE_SUB(NOW(), INTERVAL ${ATTEMPT_WINDOW_MINUTES} MINUTE), 1, attempts+1)),
       window_started_at=IF(blocked_until > NOW(), window_started_at,
         IF(window_started_at < DATE_SUB(NOW(), INTERVAL ${ATTEMPT_WINDOW_MINUTES} MINUTE), NOW(), window_started_at))`,
    [key],
  );
  const [blockResult] = await pool.execute<any>(
    `UPDATE auth_rate_limits SET blocked_until=DATE_ADD(NOW(), INTERVAL ${LOCKOUT_MINUTES} MINUTE)
     WHERE bucket_key=? AND attempts >= ${MAX_FAILED_ATTEMPTS} AND (blocked_until IS NULL OR blocked_until <= NOW())`,
    [key],
  );
  if (blockResult.affectedRows === 1) {
    const sourceIp = (req.ip ?? req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/i, "").slice(0, 120);
    await pool.execute(
      `INSERT INTO auth_security_events (source_ip, failed_attempts) VALUES (?, ?)`,
      [sourceIp, MAX_FAILED_ATTEMPTS],
    );
  }
  const [rows] = await pool.query<any[]>(
    `SELECT GREATEST(TIMESTAMPDIFF(SECOND, NOW(), blocked_until), 0) AS retry_after
     FROM auth_rate_limits WHERE bucket_key=? LIMIT 1`,
    [key],
  );
  const retryAfterSeconds = Number(rows[0]?.retry_after ?? 0);
  return retryAfterSeconds > 0
    ? { blocked: true, retryAfterSeconds }
    : { blocked: false, retryAfterSeconds: 0 };
}
