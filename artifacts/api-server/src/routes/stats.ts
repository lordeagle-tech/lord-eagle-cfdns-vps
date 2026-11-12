import { Router, type IRouter } from "express";
import { z } from "zod";
import { withSshClient, execCommand, getServerById } from "../lib/ssh";

const router: IRouter = Router();
const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.get("/servers/:id/stats", async (req, res): Promise<void> => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const server = await getServerById(params.data.id, Number(req.user?.id ?? 0));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  try {
    const stats = await withSshClient(server, async (client) => {
      const [cpuResult, memResult, diskResult, uptimeResult, hostnameResult, osResult, kernelResult, loadResult, cpuInfoResult] =
        await Promise.all([
          execCommand(client, "top -bn1 | grep '%Cpu\\|Cpu(s)' | head -1 | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || echo 0"),
          execCommand(client, "free -b | grep Mem"),
          execCommand(client, "df -h | grep -v tmpfs | grep -v devtmpfs"),
          execCommand(client, "uptime -p 2>/dev/null || uptime"),
          execCommand(client, "hostname"),
          execCommand(client, "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'\"' -f2 || uname -o"),
          execCommand(client, "uname -r"),
          execCommand(client, "cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}'"),
          execCommand(client, "nproc 2>/dev/null || grep -c processor /proc/cpuinfo 2>/dev/null || echo 1"),
        ]);

      const cpuUsage = parseFloat(cpuResult.stdout.trim()) || 0;
      const cores = parseInt(cpuInfoResult.stdout.trim(), 10) || 1;

      const memParts = memResult.stdout.trim().split(/\s+/);
      const memTotal = parseInt(memParts[1] ?? "0", 10);
      const memUsed = parseInt(memParts[2] ?? "0", 10);
      const memFree = parseInt(memParts[3] ?? "0", 10);
      const memUsagePercent = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;

      const diskLines = diskResult.stdout.trim().split("\n").filter((l) => l.trim());
      const disk = diskLines
        .filter((line) => !line.startsWith("Filesystem"))
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            filesystem: parts[0] ?? "",
            size: parts[1] ?? "",
            used: parts[2] ?? "",
            available: parts[3] ?? "",
            usePercent: parts[4] ?? "",
            mountedOn: parts[5] ?? "",
          };
        })
        .filter((d) => d.filesystem && d.mountedOn);

      const loadParts = loadResult.stdout.trim().split(/\s+/);
      const loadAverage = [
        parseFloat(loadParts[0] ?? "0"),
        parseFloat(loadParts[1] ?? "0"),
        parseFloat(loadParts[2] ?? "0"),
      ];

      return {
        cpu: {
          usage: cpuUsage,
          cores,
          model: "CPU",
        },
        memory: {
          total: memTotal,
          used: memUsed,
          free: memFree,
          usagePercent: memUsagePercent,
        },
        disk,
        uptime: uptimeResult.stdout.trim(),
        loadAverage,
        os: osResult.stdout.trim(),
        hostname: hostnameResult.stdout.trim(),
        kernel: kernelResult.stdout.trim(),
      };
    });

    res.json(stats);
  } catch (err: any) {
    res.status(502).json({ error: "Failed to get server stats" });
  }
});

export default router;
