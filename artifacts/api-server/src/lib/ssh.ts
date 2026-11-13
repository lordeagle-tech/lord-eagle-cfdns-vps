import { timingSafeEqual } from "node:crypto";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import { db, serversTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { decryptSecret } from "../security/crypto";

export interface ServerRecord {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  password: string | null;
  privateKey: string | null;
  passphrase: string | null;
  hostFingerprint: string | null;
  observedFingerprint?: string;
}

function fingerprintsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function fingerprintFromHash(keyHash: string | Buffer): string {
  const digest = typeof keyHash === "string" ? Buffer.from(keyHash, "hex") : keyHash;
  return `SHA256:${digest.toString("base64").replace(/=+$/, "")}`;
}

export async function getServerById(id: number, ownerId: number): Promise<ServerRecord | null> {
  const [server] = await db.select().from(serversTable)
    .where(and(eq(serversTable.id, id), eq(serversTable.ownerId, ownerId)));
  if (!server) return null;
  return {
    ...server,
    name: server.name,
    password: decryptSecret(server.password),
    privateKey: decryptSecret(server.privateKey),
    passphrase: decryptSecret(server.passphrase),
    hostFingerprint: server.hostFingerprint ?? null,
  };
}

export function buildConnectConfig(server: ServerRecord, allowUnpinned = false): ConnectConfig {
  const config: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.username,
    readyTimeout: 10000,
    hostHash: "sha256",
    hostVerifier: (keyHash: string | Buffer) => {
      const observed = fingerprintFromHash(keyHash);
      server.observedFingerprint = observed;
      if (!server.hostFingerprint) return allowUnpinned;
      return fingerprintsEqual(observed, server.hostFingerprint);
    },
  };

  if ((server.authType === "key" || server.authType === "privateKey") && server.privateKey) {
    config.privateKey = server.privateKey;
    if (server.passphrase) config.passphrase = server.passphrase;
  } else if (server.password) {
    config.password = server.password;
  }
  return config;
}

export function withSshClient<T>(
  server: ServerRecord,
  fn: (client: Client) => Promise<T>,
  options: { allowUnpinned?: boolean } = {},
): Promise<T> {
  if (process.env.NODE_ENV !== "production" || process.env.CFDNS_ENABLE_SSH === "false") {
    return Promise.reject(new Error("Outbound SSH is disabled in this environment."));
  }
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      client.end();
      if (error) {
        if (server.hostFingerprint && server.observedFingerprint && !fingerprintsEqual(server.hostFingerprint, server.observedFingerprint)) {
          reject(new Error(`SSH host key mismatch. Expected ${server.hostFingerprint}; observed ${server.observedFingerprint}.`));
        } else if (!server.hostFingerprint && server.observedFingerprint && !options.allowUnpinned) {
          reject(new Error(`SSH host key must be trusted first: ${server.observedFingerprint}`));
        } else reject(error);
      } else resolve(value as T);
    };

    client.on("ready", async () => {
      try { finish(undefined, await fn(client)); }
      catch (error) { finish(error instanceof Error ? error : new Error("SSH operation failed")); }
    });
    client.on("error", (error) => finish(error));
    client.on("close", () => {
      if (!settled) finish(new Error("SSH connection closed before it was ready"));
    });

    try { client.connect(buildConnectConfig(server, options.allowUnpinned)); }
    catch (error) { finish(error instanceof Error ? error : new Error("SSH connection failed")); }
  });
}

export function execCommand(
  client: Client,
  command: string,
  timeoutMs = 30000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) { reject(err); return; }
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let overflow = false;
      const maxOutput = 2 * 1024 * 1024;
      const timer = setTimeout(() => {
        timedOut = true;
        stream.close();
      }, timeoutMs);
      const collect = (target: "stdout" | "stderr", data: Buffer) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >= maxOutput) {
          overflow = true;
          stream.close();
          return;
        }
        const remaining = maxOutput - Buffer.byteLength(stdout) - Buffer.byteLength(stderr);
        const value = data.toString("utf8").slice(0, remaining);
        if (target === "stdout") stdout += value;
        else stderr += value;
      };
      stream.on("data", (data: Buffer) => collect("stdout", data));
      stream.stderr.on("data", (data: Buffer) => collect("stderr", data));
      stream.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: timedOut ? `${stderr}\nCommand timed out after ${timeoutMs} ms.`.trim() : overflow ? `${stderr}\nOutput truncated at 2 MB.`.trim() : stderr,
          exitCode: timedOut ? 124 : overflow ? 125 : code ?? 0,
        });
      });
      stream.on("error", (error: Error) => { clearTimeout(timer); reject(error); });
    });
  });
}

export function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => { if (err) reject(err); else resolve(sftp); });
  });
}

export function sftpReaddir(sftp: SFTPWrapper, remotePath: string): Promise<any[]> {
  return new Promise((resolve, reject) => { sftp.readdir(remotePath, (err, list) => { if (err) reject(err); else resolve(list); }); });
}

export function sftpReadFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => { sftp.readFile(remotePath, (err, data) => { if (err) reject(err); else resolve(data); }); });
}

export function sftpWriteFile(sftp: SFTPWrapper, remotePath: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => { sftp.writeFile(remotePath, data, (err) => { if (err) reject(err); else resolve(); }); });
}

export function sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => { sftp.unlink(remotePath, (err) => { if (err) reject(err); else resolve(); }); });
}

export function sftpRmdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => { sftp.rmdir(remotePath, (err) => { if (err) reject(err); else resolve(); }); });
}

export function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => { sftp.mkdir(remotePath, (err) => { if (err) reject(err); else resolve(); }); });
}

export function sftpRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => { sftp.rename(oldPath, newPath, (err) => { if (err) reject(err); else resolve(); }); });
}

export function sftpStat(sftp: SFTPWrapper, remotePath: string): Promise<any> {
  return new Promise((resolve, reject) => { sftp.lstat(remotePath, (err, stats) => { if (err) reject(err); else resolve(stats); }); });
}
