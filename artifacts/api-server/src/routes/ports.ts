import { Router } from "express";
import { z } from "zod";
import { getServerById, withSshClient, execCommand } from "../lib/ssh";
import { parseListeningPorts } from "../lib/ports";
import { logger } from "../lib/logger";

const router = Router();
const idSchema = z.coerce.number().int().positive();

router.get("/servers/:id/ports", async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: "Invalid saved VPS connection" });
  const server = await getServerById(parsed.data, Number(req.user?.id ?? 0));
  if (!server) return res.status(404).json({ error: "Saved VPS connection not found" });
  if (!server.hostFingerprint) {
    return res.status(409).json({ error: "Verify and trust this VPS SSH host fingerprint in Connections before scanning ports." });
  }

  try {
    const result = await withSshClient(server, (client) =>
      execCommand(client, "sudo -n ss -H -lntup 2>/dev/null || ss -H -lntup", 15_000),
    );
    if (result.exitCode !== 0) {
      logger.warn({ serverId: server.id, exitCode: result.exitCode, stderr: result.stderr }, "Remote port scan command failed");
      return res.status(502).json({ error: "Could not read listening sockets on this VPS. Confirm it is Linux with `ss` installed and SSH access is available." });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      server: { id: server.id, name: server.name, host: server.host, scope: "remote" },
      ports: parseListeningPorts(result.stdout),
      scannedAt: new Date().toISOString(),
      note: "These are listening sockets. A host, cloud-provider, or network firewall may still block external access. Process names are shown when the SSH account can see them.",
    });
  } catch (error) {
    logger.warn({ err: error, serverId: server.id }, "Could not scan remote VPS ports");
    res.status(502).json({ error: "Could not connect to this VPS. Verify its connection and pinned SSH host key." });
  }
});

export default router;
