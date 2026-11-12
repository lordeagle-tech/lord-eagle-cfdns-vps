import { Client, ConnectConfig, SFTPWrapper } from "ssh2";
import { db, serversTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
}

export async function getServerById(id: number): Promise<ServerRecord | null> {
  const [server] = await db
    .select()
    .from(serversTable)
    .where(eq(serversTable.id, id));
  return server ?? null;
}

export function buildConnectConfig(server: ServerRecord): ConnectConfig {
  const config: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.username,
    readyTimeout: 10000,
  };

  if (server.authType === "key" && server.privateKey) {
    config.privateKey = server.privateKey;
    if (server.passphrase) {
      config.passphrase = server.passphrase;
    }
  } else if (server.password) {
    config.password = server.password;
  }

  return config;
}

export function withSshClient<T>(
  server: ServerRecord,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const config = buildConnectConfig(server);

    client.on("ready", async () => {
      try {
        const result = await fn(client);
        client.end();
        resolve(result);
      } catch (err) {
        client.end();
        reject(err);
      }
    });

    client.on("error", (err) => {
      reject(err);
    });

    client.connect(config);
  });
}

export function execCommand(
  client: Client,
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";
      let exitCode = 0;

      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      stream.on("close", (code: number) => {
        exitCode = code ?? 0;
        resolve({ stdout, stderr, exitCode });
      });

      stream.on("error", reject);
    });
  });
}

export function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(err);
      else resolve(sftp);
    });
  });
}

export function sftpReaddir(sftp: SFTPWrapper, path: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => {
      if (err) reject(err);
      else resolve(list);
    });
  });
}

export function sftpReadFile(sftp: SFTPWrapper, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(path, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

export function sftpWriteFile(sftp: SFTPWrapper, path: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(path, data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function sftpUnlink(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(path, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function sftpRmdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(path, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function sftpMkdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(path, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function sftpRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function sftpStat(sftp: SFTPWrapper, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    sftp.lstat(path, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
}
