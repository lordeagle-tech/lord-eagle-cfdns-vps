import { Router } from "express";
import { z } from "zod";
import { getServerById, withSshClient, execCommand } from "../lib/ssh";
import { audit } from "../security/audit";
import { logger } from "../lib/logger";

const router = Router();
const idSchema = z.coerce.number().int().positive();
const allowSchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["tcp", "udp"]),
  confirmation: z.string().max(260),
});

type UfwRule = { number: number; to: string; action: string; direction: string; from: string };
type UfwStatus = { available: boolean; active: boolean | null; defaultIncoming: string | null; rules: UfwRule[]; message?: string };
function parseUfw(output: string): UfwStatus {
  const statusMatch = output.match(/^Status:\s*(active|inactive)\s*$/im);
  if (!statusMatch) return { available: false, active: null, defaultIncoming: null, rules: [], message: "Could not read UFW status. Confirm UFW is installed and noninteractive sudo access is available for this SSH user." };
  const defaultMatch = output.match(/^Default:\s*([^,\r\n]+)/im);
  const rules: UfwRule[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\[\s*(\d+)\]\s+(.+?)\s+(ALLOW|DENY|REJECT|LIMIT)\s+(IN|OUT)\s+(.+)$/i);
    if (!match) continue;
    rules.push({ number: Number(match[1]), to: match[2].trim(), action: match[3].toUpperCase(), direction: match[4].toUpperCase(), from: match[5].trim() });
  }
  return { available: true, active: statusMatch[1].toLowerCase() === "active", defaultIncoming: defaultMatch?.[1]?.trim() ?? null, rules };
}
async function readStatus(server: NonNullable<Awaited<ReturnType<typeof getServerById>>>): Promise<UfwStatus> {
  const result = await withSshClient(server, (client) => execCommand(client, "sudo -n ufw status verbose && printf '\\n--CFDNS-UFW-RULES--\\n' && sudo -n ufw status numbered", 15_000));
  if (result.exitCode !== 0) return { available: false, active: null, defaultIncoming: null, rules: [], message: "UFW status is unavailable. UFW may not be installed, or this SSH user may need noninteractive sudo permission." };
  return parseUfw(result.stdout);
}
async function ownedPinnedServer(req: any, res: any) {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) { res.status(400).json({ error: "Invalid VPS connection" }); return null; }
  const server = await getServerById(parsed.data, Number(req.user?.id ?? 0));
  if (!server) { res.status(404).json({ error: "Saved VPS connection not found" }); return null; }
  if (!server.hostFingerprint) { res.status(409).json({ error: "Verify and trust this VPS SSH host fingerprint before checking its firewall" }); return null; }
  return server;
}

router.get("/servers/:id/firewall", async (req, res) => {
  const server = await ownedPinnedServer(req, res);
  if (!server) return;
  try {
    const status = await readStatus(server);
    res.setHeader("Cache-Control", "no-store");
    res.json({ server: { id: server.id, name: server.name, host: server.host, sshPort: server.port }, ...status });
  } catch (error) {
    logger.warn({ err: error, serverId: server.id }, "Could not read remote UFW status");
    res.status(502).json({ error: "Could not connect to this VPS or read its UFW status" });
  }
});

router.post("/servers/:id/firewall/allow", async (req, res) => {
  const server = await ownedPinnedServer(req, res);
  if (!server) return;
  const parsed = allowSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a valid port, TCP/UDP protocol, and explicit confirmation" }); return; }
  const { port, protocol, confirmation } = parsed.data;
  if (confirmation !== `ALLOW ${port}/${protocol.toUpperCase()} ON ${server.name}`) {
    res.status(400).json({ error: `Type ALLOW ${port}/${protocol.toUpperCase()} ON ${server.name} exactly to confirm` }); return;
  }
  try {
    const current = await readStatus(server);
    if (!current.available) { res.status(409).json({ error: current.message }); return; }
    if (!current.active) { res.status(409).json({ error: "UFW is inactive. This panel will not enable the firewall; enable it through your provider console or direct SSH after reviewing the SSH/web access rules." }); return; }
    const result = await withSshClient(server, (client) => execCommand(client, `sudo -n ufw allow ${port}/${protocol}`, 15_000));
    if (result.exitCode !== 0) {
      await audit(req, "server.firewall.allow", "server", server.id, "failed", { port, protocol });
      res.status(502).json({ error: "UFW did not add the rule. Check noninteractive sudo access and the server firewall state." }); return;
    }
    const status = await readStatus(server);
    await audit(req, "server.firewall.allow", "server", server.id, "success", { port, protocol, ruleAdded: /Rule added/i.test(result.stdout) });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, server: { id: server.id, name: server.name, host: server.host }, port, protocol, status });
  } catch (error) {
    logger.warn({ err: error, serverId: server.id, port, protocol }, "Could not add remote UFW allow rule");
    await audit(req, "server.firewall.allow", "server", server.id, "failed", { port, protocol }).catch(() => undefined);
    res.status(502).json({ error: "Could not apply the UFW rule on this VPS" });
  }
});

export default router;
