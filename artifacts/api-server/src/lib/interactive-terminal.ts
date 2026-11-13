import type { IncomingMessage } from "node:http";
import type { Server, Socket } from "node:net";
import type { Request } from "express";
import os from "node:os";
import * as pty from "node-pty";
import { Client } from "ssh2";
import { WebSocketServer, WebSocket } from "ws";
import { currentUser } from "../security/session";
import { audit } from "../security/audit";
import { isAdminIpAllowed, isTrustedBrowserOrigin } from "../middleware/auth";
import { buildConnectConfig, getServerById, type ServerRecord } from "./ssh";

const LOCAL_WS_PATH = "/api/terminal/session";
const REMOTE_WS_PATTERN = /^\/api\/servers\/([1-9]\d*)\/terminal\/session$/;
const MAX_SESSIONS_PER_USER = 2;
const MAX_SESSION_MS = 2 * 60 * 60 * 1000;
const MAX_BUFFERED_OUTPUT = 2 * 1024 * 1024;
const activeByUser = new Map<number, number>();

function firstHeader(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").split(",")[0].trim();
}

function expressRequest(req: IncomingMessage): Request {
  const forwardedFor = firstHeader(req.headers["x-forwarded-for"]);
  const proto = firstHeader(req.headers["x-forwarded-proto"]) || ((req.socket as any).encrypted ? "https" : "http");
  const headers = req.headers;
  return {
    headers,
    protocol: proto,
    ip: forwardedFor || req.socket.remoteAddress || "",
    socket: req.socket,
    get(name: string) {
      const value = headers[name.toLowerCase()];
      return Array.isArray(value) ? value.join(", ") : value;
    },
  } as unknown as Request;
}

function rejectUpgrade(socket: Socket, status: number, message: string): void {
  const phrases: Record<number, string> = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 429: "Too Many Requests", 503: "Service Unavailable" };
  const phrase = phrases[status] ?? "Bad Request";
  const safeMessage = message.replace(/[\r\n]/g, " ");
  socket.end(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(safeMessage)}\r\n\r\n${safeMessage}`);
}

function parseMessage(value: unknown): { type: string; data?: string; cols?: number; rows?: number } | null {
  if (typeof value !== "string" || value.length > 64 * 1024) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function attachInteractiveTerminal(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const remoteMatch = pathname.match(REMOTE_WS_PATTERN);
    if (pathname !== LOCAL_WS_PATH && !remoteMatch) {
      socket.destroy();
      return;
    }

    void (async () => {
      const authRequest = expressRequest(request);
      if (!isTrustedBrowserOrigin(authRequest) || !isAdminIpAllowed(authRequest)) {
        rejectUpgrade(socket, 403, "Browser origin or network is not allowed");
        return;
      }
      const user = await currentUser(authRequest);
      if (!user || user.role !== "admin") {
        rejectUpgrade(socket, 401, "Sign in as an administrator to use the terminal");
        return;
      }
      let remoteServer: ServerRecord | null = null;
      if (remoteMatch) {
        if (process.env.NODE_ENV !== "production" || process.env.CFDNS_ENABLE_SSH === "false") {
          rejectUpgrade(socket, 503, "Remote SSH is disabled in this environment");
          return;
        }
        const serverId = Number(remoteMatch[1]);
        if (!Number.isSafeInteger(serverId)) {
          rejectUpgrade(socket, 400, "Invalid VPS id");
          return;
        }
        remoteServer = await getServerById(serverId, user.id);
        if (!remoteServer) {
          rejectUpgrade(socket, 404, "Saved VPS not found");
          return;
        }
        if (!remoteServer.hostFingerprint) {
          rejectUpgrade(socket, 409, "Verify and pin this VPS host key before opening a remote shell");
          return;
        }
      }
      const active = activeByUser.get(user.id) ?? 0;
      if (active >= MAX_SESSIONS_PER_USER) {
        rejectUpgrade(socket, 429, "Too many active terminal sessions");
        return;
      }

      authRequest.user = user;
      wss.handleUpgrade(request, socket, head, (ws) => {
        activeByUser.set(user.id, active + 1);
        if (remoteServer) startRemoteShell(ws, authRequest, user.id, remoteServer);
        else startShell(ws, authRequest, user.id);
      });
    })().catch(() => {
      if (!socket.destroyed) rejectUpgrade(socket, 403, "Terminal authentication failed");
    });
  });

  server.on("close", () => wss.close());
}

function remoteFailureMessage(server: ServerRecord): string {
  if (!server.hostFingerprint) return "This VPS has no trusted host-key pin. Verify it from VPS Connections before opening a shell.";
  if (server.observedFingerprint && server.observedFingerprint !== server.hostFingerprint) {
    return `SSH host key changed. Expected ${server.hostFingerprint}; observed ${server.observedFingerprint}. Verify the new fingerprint with your VPS provider before changing the pin.`;
  }
  return "Could not open the remote SSH shell. Check that the VPS is reachable, its SSH credentials are valid, and its pinned host key has not changed.";
}

function startRemoteShell(ws: WebSocket, request: Request, userId: number, server: ServerRecord): void {
  const client = new Client();
  let channel: any = null;
  let finalized = false;
  let sessionAudited = false;
  let pendingInput = "";
  let pendingResize = { cols: 100, rows: 28 };
  const openedAt = Date.now();

  const send = (value: Record<string, unknown>) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_OUTPUT) {
      ws.close(1013, "Terminal output exceeded the session buffer limit");
      finish();
      return;
    }
    ws.send(JSON.stringify(value));
  };
  const fail = () => {
    send({ type: "error", message: remoteFailureMessage(server) });
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, "Remote SSH shell failed");
    finish();
  };

  const expireTimer = setTimeout(() => {
    send({ type: "notice", message: "This remote shell reached its two-hour limit. Reconnect to start another session." });
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, "Terminal session limit reached");
    finish();
  }, MAX_SESSION_MS);
  expireTimer.unref?.();

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      ws.close(1003, "Text messages required");
      finish();
      return;
    }
    const message = parseMessage(raw.toString());
    if (!message) {
      ws.close(1008, "Invalid terminal message");
      finish();
      return;
    }
    if (message.type === "input" && typeof message.data === "string") {
      if (message.data.length > 16 * 1024) return;
      if (channel) channel.write(message.data);
      else if (pendingInput.length + message.data.length <= 64 * 1024) pendingInput += message.data;
      return;
    }
    if (message.type === "resize") {
      const cols = Number(message.cols);
      const rows = Number(message.rows);
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols >= 20 && cols <= 400 && rows >= 5 && rows <= 150) {
        pendingResize = { cols, rows };
        if (channel) channel.setWindow(rows, cols, 0, 0);
      }
      return;
    }
    ws.close(1008, "Unsupported terminal message");
    finish();
  });
  ws.on("close", finish);
  ws.on("error", finish);

  client.on("ready", () => {
    client.shell({ term: "xterm-256color", cols: pendingResize.cols, rows: pendingResize.rows }, (error, shell) => {
      if (error) {
        fail();
        return;
      }
      channel = shell;
      if (ws.readyState !== WebSocket.OPEN) {
        finish();
        return;
      }
      sessionAudited = true;
      void audit(request, "terminal.remote.session.open", "server", server.id, "success", { username: server.username, transport: "ssh-pty" }).catch(() => undefined);
      send({ type: "notice", message: `Connected to ${server.name} as ${server.username}@${server.host}. Commands run with that SSH account's permissions.` });
      channel.setWindow(pendingResize.rows, pendingResize.cols, 0, 0);
      if (pendingInput) {
        channel.write(pendingInput);
        pendingInput = "";
      }
      channel.on("data", (data: Buffer | string) => send({ type: "output", data: data.toString() }));
      channel.on("close", (code: number | null, signal: string | null) => {
        send({ type: "exit", exitCode: code, signal });
        if (ws.readyState === WebSocket.OPEN) ws.close(1000, "Remote shell exited");
        finish();
      });
      channel.on("error", fail);
    });
  });
  client.on("error", fail);
  client.on("close", () => { if (!finalized) fail(); });

  try {
    const config = buildConnectConfig(server);
    config.keepaliveInterval = 15_000;
    config.keepaliveCountMax = 3;
    send({ type: "notice", message: `Connecting to ${server.host} over SSH using its pinned host key…` });
    client.connect(config);
  } catch {
    fail();
  }

  function finish(): void {
    if (finalized) return;
    finalized = true;
    clearTimeout(expireTimer);
    if (channel && !channel.destroyed) channel.close();
    client.end();
    decrementActive(userId);
    if (sessionAudited) {
      void audit(request, "terminal.remote.session.close", "server", server.id, "success", {
        durationSeconds: Math.max(0, Math.round((Date.now() - openedAt) / 1000)),
        username: server.username,
      }).catch(() => undefined);
    } else {
      void audit(request, "terminal.remote.session.open", "server", server.id, "failed", { username: server.username }).catch(() => undefined);
    }
  }
}

function startShell(ws: WebSocket, request: Request, userId: number): void {
  const home = process.env.HOME || os.homedir();
  const shellEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/(DATABASE_URL|ENCRYPTION_KEY|API_KEY|ACCESS_TOKEN|SECRET|PASSWORD|PRIVATE_KEY)/i.test(key)),
  ) as NodeJS.ProcessEnv;
  let shell: pty.IPty;
  try {
    shell = pty.spawn("/bin/bash", ["--noprofile", "--norc", "-i"], {
      name: "xterm-256color",
      cols: 100,
      rows: 28,
      cwd: home,
      env: {
        ...shellEnv,
        HOME: home,
        PWD: home,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        PS1: "\\u@\\h:\\w\\$ ",
      },
    });
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Could not start the unprivileged Linux shell. Check that the PTY runtime is installed." }));
    ws.close(1011, "PTY unavailable");
    decrementActive(userId);
    return;
  }

  let finalized = false;
  const openedAt = Date.now();
  const expireTimer = setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "notice", message: "This terminal session reached its two-hour limit. Reconnect to start another session." }));
      ws.close(1000, "Terminal session limit reached");
    }
    shell.kill();
  }, MAX_SESSION_MS);
  expireTimer.unref?.();

  void audit(request, "terminal.session.open", "host", "local", "success", { shell: "bash", privilege: "service-user" }).catch(() => undefined);

  shell.onData((data) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_OUTPUT) {
      ws.close(1013, "Terminal output exceeded the session buffer limit");
      shell.kill();
      return;
    }
    ws.send(JSON.stringify({ type: "output", data }));
  });

  shell.onExit(({ exitCode, signal }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      ws.close(1000, "Shell exited");
    }
    finish();
  });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      ws.close(1003, "Text messages required");
      shell.kill();
      return;
    }
    const message = parseMessage(raw.toString());
    if (!message) {
      ws.close(1008, "Invalid terminal message");
      shell.kill();
      return;
    }
    if (message.type === "input" && typeof message.data === "string") {
      if (message.data.length <= 16 * 1024) shell.write(message.data);
      return;
    }
    if (message.type === "resize") {
      const cols = Number(message.cols);
      const rows = Number(message.rows);
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols >= 20 && cols <= 400 && rows >= 5 && rows <= 150) {
        shell.resize(cols, rows);
      }
      return;
    }
    ws.close(1008, "Unsupported terminal message");
    shell.kill();
  });

  ws.on("close", () => {
    shell.kill();
    finish();
  });
  ws.on("error", () => {
    shell.kill();
    finish();
  });

  function finish(): void {
    if (finalized) return;
    finalized = true;
    clearTimeout(expireTimer);
    decrementActive(userId);
    void audit(request, "terminal.session.close", "host", "local", "success", {
      durationSeconds: Math.max(0, Math.round((Date.now() - openedAt) / 1000)),
      privilege: "service-user",
    }).catch(() => undefined);
  }
}

function decrementActive(userId: number): void {
  const next = (activeByUser.get(userId) ?? 1) - 1;
  if (next <= 0) activeByUser.delete(userId);
  else activeByUser.set(userId, next);
}
