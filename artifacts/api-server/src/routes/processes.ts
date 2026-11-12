import { Router, type IRouter } from "express";
import { z } from "zod";
import { withSshClient, execCommand, getServerById } from "../lib/ssh";

const router: IRouter = Router();
const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
const killBodySchema = z.object({ signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT"]).optional() });

router.get("/servers/:id/processes", async (req, res): Promise<void> => {
  const idParsed = paramsSchema.safeParse(req.params);
  if (!idParsed.success) {
    res.status(400).json({ error: idParsed.error.message });
    return;
  }

  const server = await getServerById(idParsed.data.id, Number(req.user?.id ?? 0));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  try {
    const result = await withSshClient(server, async (client) => {
      const { stdout } = await execCommand(
        client,
        "ps aux --no-headers 2>/dev/null || ps aux 2>/dev/null | tail -n +2"
      );
      return stdout;
    });

    const processes = result
      .split("\n")
      .filter((line: string) => line.trim())
      .map((line: string) => {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[1] ?? "0", 10);
        const user = parts[0] ?? "";
        const cpu = parseFloat(parts[2] ?? "0");
        const mem = parseFloat(parts[3] ?? "0");
        const status = parts[7] ?? "";
        const command = parts.slice(10).join(" ") || parts[10] || "";
        return { pid, user, cpu, mem, command, status };
      })
      .filter((p: any) => !isNaN(p.pid) && p.pid > 0);

    res.json({ processes, count: processes.length });
  } catch (err: any) {
    res.status(502).json({ error: "Failed to list processes" });
  }
});

router.post("/servers/:id/processes/:pid/kill", async (req, res): Promise<void> => {
  const params = paramsSchema.extend({ pid: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  const bodyParsed = killBodySchema.safeParse(req.body ?? {});
  const signal = bodyParsed.success ? (bodyParsed.data.signal ?? "SIGTERM") : "SIGTERM";

  const server = await getServerById(params.data.id, Number(req.user?.id ?? 0));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  try {
    await withSshClient(server, async (client) => {
      const sigMap: Record<string, string> = {
        SIGTERM: "15",
        SIGKILL: "9",
        SIGINT: "2",
      };
      const sigNum = sigMap[signal] ?? "15";
      await execCommand(client, `kill -${sigNum} ${params.data.pid}`);
    });

    res.json({ success: true, message: `Process ${params.data.pid} killed` });
  } catch (err: any) {
    res.status(502).json({ error: "Failed to stop process" });
  }
});

export default router;
