import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

router.get("/audit/logs", async (req, res) => {
  const ownerId = Number(req.user?.id ?? 0);
  const requested = Number(req.query.limit ?? 30);
  const limit = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 100)) : 30;
  if (!ownerId) { res.status(401).json({ error: "Not signed in" }); return; }
  try {
    const [rows] = await pool.query<any[]>(
      `SELECT id, action, target_type AS targetType, target_id AS targetId, status, created_at AS createdAt
       FROM audit_logs WHERE owner_id=? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [ownerId, limit],
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ entries: rows });
  } catch {
    res.status(503).json({ error: "Audit records are temporarily unavailable" });
  }
});

export default router;
