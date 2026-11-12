import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 10;
let calls = 0;

function bucket(req: Request): string {
  const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/i, "").slice(0, 120);
  return `login:${ip}`;
}

export async function resetLoginRateLimit(req: Request): Promise<void> {
  await pool.execute(`DELETE FROM auth_rate_limits WHERE bucket_key=?`, [bucket(req)]);
}

/** Persistent, shared limiter. Fail closed if its backing store is unavailable. */
export async function loginRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const key = bucket(req);
    await pool.execute(
      `INSERT INTO auth_rate_limits (bucket_key, window_started_at, attempts, blocked_until)
       VALUES (?, NOW(), 1, NULL)
       ON DUPLICATE KEY UPDATE
         blocked_until=IF(window_started_at < DATE_SUB(NOW(), INTERVAL ${WINDOW_MINUTES} MINUTE), NULL,
           IF(attempts >= ${MAX_ATTEMPTS}, DATE_ADD(NOW(), INTERVAL ${WINDOW_MINUTES} MINUTE), blocked_until)),
         attempts=IF(window_started_at < DATE_SUB(NOW(), INTERVAL ${WINDOW_MINUTES} MINUTE), 1, attempts+1),
         window_started_at=IF(window_started_at < DATE_SUB(NOW(), INTERVAL ${WINDOW_MINUTES} MINUTE), NOW(), window_started_at)`,
      [key],
    );
    const [rows] = await pool.query<any[]>(`SELECT attempts, blocked_until FROM auth_rate_limits WHERE bucket_key=? LIMIT 1`, [key]);
    const blockedUntil = rows[0]?.blocked_until ? new Date(rows[0].blocked_until).getTime() : 0;
    if (blockedUntil > Date.now()) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000))));
      res.status(429).json({ error: "Too many login attempts. Try again later." });
      return;
    }
    if (++calls % 100 === 0) {
      void pool.query(`DELETE FROM auth_rate_limits WHERE window_started_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)`).catch(() => undefined);
    }
    next();
  } catch {
    res.status(503).json({ error: "Sign-in protection is temporarily unavailable" });
  }
}
