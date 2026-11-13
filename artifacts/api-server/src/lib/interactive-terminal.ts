import type { IncomingMessage } from "node:http";
import type { Server, Socket } from "node:net";
import type { Request } from "express";
import os from "node:os";
import * as pty from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import { currentUser } from "../security/session";
import { audit } from "../security/audit";
import { isAdminIpAllowed, isTrustedBrowserOrigin } from "../middleware/auth";

const WS_PATH = "/api/terminal/session";
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
  const phrase = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 429 ? "Too Many Requests" : "Bad Request";
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
    if (pathname !== WS_PATH) {
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
      const active = activeByUser.get(user.id) ?? 0;
      if (active >= MAX_SESSIONS_PER_USER) {
        rejectUpgrade(socket, 429, "Too many active terminal sessions");
        return;
      }

      authRequest.user = user;
      wss.handleUpgrade(request, socket, head, (ws) => {
        activeByUser.set(user.id, active + 1);
        startShell(ws, authRequest, user.id);
      });
    })().catch(() => {
      if (!socket.destroyed) rejectUpgrade(socket, 403, "Terminal authentication failed");
    });
  });

  server.on("close", () => wss.close());
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
