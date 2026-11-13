export type ListeningPort = {
  protocol: "tcp" | "udp";
  port: number;
  address: string;
  state: string;
  process: string | null;
  pid: number | null;
};

/** Parse `ss -H -lntup` output. This reports bound/listening sockets, not firewall reachability. */
export function parseListeningPorts(output: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 6) continue;
    const netid = columns[0].toLowerCase();
    const protocol = netid.startsWith("tcp") ? "tcp" : netid.startsWith("udp") ? "udp" : null;
    if (!protocol) continue;

    const local = columns[4];
    const separator = local.lastIndexOf(":");
    if (separator < 0) continue;
    const port = Number(local.slice(separator + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;

    const socketInfo = columns.slice(6).join(" ");
    const processMatch = socketInfo.match(/users:\(\("([^"]+)"(?:,pid=(\d+))?/);
    ports.push({
      protocol,
      port,
      address: local.slice(0, separator).replace(/^\[(.*)\]$/, "$1") || "*",
      state: columns[1].toUpperCase(),
      process: processMatch?.[1] ?? null,
      pid: processMatch?.[2] ? Number(processMatch[2]) : null,
    });
  }
  return ports.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol) || a.address.localeCompare(b.address));
}
