import { pool } from "@workspace/db";
import type { Request } from "express";
export async function audit(req: Request, action: string, targetType: string, targetId: string | number | null, status: "success" | "failed", metadata?: Record<string, unknown>): Promise<void> {
  const ownerId = Number(req.user?.id ?? 0);
  if (!ownerId) return;
  await pool.execute(`INSERT INTO audit_logs (owner_id, action, target_type, target_id, status, metadata) VALUES (?, ?, ?, ?, ?, ?)`, [ownerId, action, targetType, targetId == null ? null : String(targetId), status, metadata ? JSON.stringify(metadata) : null]);
}
