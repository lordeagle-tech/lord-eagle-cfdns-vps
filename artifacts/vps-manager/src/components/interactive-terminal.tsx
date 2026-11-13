import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { RefreshCw, Terminal as TerminalIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import "@xterm/xterm/css/xterm.css";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";
type ServerMessage = { type: "output" | "notice" | "error" | "exit"; data?: string; message?: string; exitCode?: number; signal?: number };

export default function InteractiveTerminal({ onClose }: { onClose?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const inputQueue: string[] = [];
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      scrollback: 8000,
      fontSize: 13,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      theme: {
        background: "#050708",
        foreground: "#d4e3e7",
        cursor: "#67e8f9",
        selectionBackground: "#155e75aa",
        black: "#111827",
        red: "#fb7185",
        green: "#86efac",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#67e8f9",
        white: "#e5e7eb",
        brightBlack: "#64748b",
        brightRed: "#fda4af",
        brightGreen: "#bbf7d0",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#a5f3fc",
        brightWhite: "#f8fafc",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);

    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${window.location.host}/api/terminal/session`);
    setState("connecting");
    terminal.writeln("\x1b[90mOpening a secure PTY-backed Bash session…\x1b[0m");

    const send = (payload: object) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    const resizeSubscription = terminal.onResize(({ cols, rows }) => send({ type: "resize", cols, rows }));
    const inputSubscription = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) send({ type: "input", data });
      else if (socket.readyState === WebSocket.CONNECTING && inputQueue.length < 200) inputQueue.push(data);
    });

    socket.addEventListener("open", () => {
      if (disposed) return;
      setState("connected");
      fit.fit();
      send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
      for (const data of inputQueue.splice(0)) send({ type: "input", data });
      terminal.focus();
    });
    socket.addEventListener("message", (event) => {
      if (disposed || typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "output" && typeof message.data === "string") terminal.write(message.data);
        else if (message.type === "notice") terminal.writeln(`\r\n\x1b[33m${message.message ?? "Terminal notice"}\x1b[0m`);
        else if (message.type === "error") {
          setState("error");
          terminal.writeln(`\r\n\x1b[31m${message.message ?? "Terminal failed to start"}\x1b[0m`);
        } else if (message.type === "exit") {
          terminal.writeln(`\r\n\x1b[90mShell exited (code ${message.exitCode ?? "?"}). Reconnect to start a new shell.\x1b[0m`);
        }
      } catch {
        terminal.writeln("\r\n\x1b[31mReceived an invalid terminal response.\x1b[0m");
      }
    });
    socket.addEventListener("close", () => {
      if (!disposed) setState((current) => current === "error" ? "error" : "disconnected");
    });
    socket.addEventListener("error", () => {
      if (!disposed) {
        setState("error");
        terminal.writeln("\r\n\x1b[31mConnection failed. Make sure you are signed in, then reconnect.\x1b[0m");
      }
    });

    const observer = new ResizeObserver(() => {
      if (disposed) return;
      requestAnimationFrame(() => {
        try { fit.fit(); } catch { /* terminal may be between layout states */ }
      });
    });
    observer.observe(container);
    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* container may not have a measured size yet */ }
    });

    return () => {
      disposed = true;
      observer.disconnect();
      resizeSubscription.dispose();
      inputSubscription.dispose();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, "Terminal view closed");
      terminal.dispose();
    };
  }, [attempt]);

  const statusText = state === "connected" ? "CONNECTED" : state === "connecting" ? "CONNECTING" : state === "error" ? "CONNECTION ERROR" : "DISCONNECTED";
  const statusColor = state === "connected" ? "text-emerald-300" : state === "connecting" ? "text-amber-200" : "text-rose-300";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-cyan-200/10 bg-[#070a0c]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0d1215] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon className="h-4 w-4 shrink-0 text-cyan-200" />
          <span className="text-sm font-semibold text-foreground">Interactive Linux shell</span>
          <span className={`ml-2 text-[10px] font-bold tracking-[.14em] ${statusColor}`}>{statusText}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">Runs as the manager's unprivileged service account</span>
          {state !== "connected" && <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)} className="h-8 border-cyan-200/20 hover:bg-cyan-300/10"><RefreshCw className="mr-2 h-3.5 w-3.5" />Reconnect</Button>}
          {onClose && <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Close terminal" aria-label="Close terminal"><X className="h-4 w-4" /></Button>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-[#050708] p-2 sm:p-3">
        <div ref={containerRef} className="h-full w-full" aria-label="Interactive Linux terminal" />
      </div>
    </section>
  );
}
