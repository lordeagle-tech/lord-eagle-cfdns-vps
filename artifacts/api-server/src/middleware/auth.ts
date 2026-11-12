import type { Request, Response, NextFunction } from "express";
import { currentUser, type AppUser } from "../security/session";
declare global { namespace Express { interface Request { user?: AppUser } } }
export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const user = await currentUser(req); if (!user) { res.status(401).json({ error: "Authentication required" }); return; } req.user = user; next(); }
  catch { res.status(503).json({ error: "Authentication service unavailable" }); }
}
