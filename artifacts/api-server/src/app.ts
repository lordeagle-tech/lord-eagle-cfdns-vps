import express, { type Express } from "express";
import path from "node:path";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { honeypotTrap } from "./middleware/guard";


const app: Express = express();

// Trust the Nginx reverse-proxy so req.ip resolves to the real client IP
// (read from X-Forwarded-For) instead of 127.0.0.1.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  const csp = [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:", "font-src 'self' data: https://fonts.gstatic.com", "connect-src 'self' wss:",
  ];
  if (process.env.NODE_ENV === "production") csp.push("upgrade-insecure-requests");
  res.setHeader("Content-Security-Policy", csp.join("; "));
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0].trim();
  if (process.env.NODE_ENV === "production" && proto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  next();
});

const allowedOrigins = new Set(
  [process.env.APP_ORIGIN ?? "", process.env.APP_ALLOWED_ORIGINS ?? ""]
    .join(",")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try { return [new URL(value).origin]; } catch { return []; }
    }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    callback(null, allowedOrigins.has(origin));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Global bot / curl guard ────────────────────────────────────────────────
// Keep health and browser navigation available; authorization is enforced per API route.
// The old bot blacklist was designed for a private single-owner console and is not suitable for a public service.


// ── Honeypot routes — bans any IP that probes these paths ─────────────────
const HONEYPOT_PATHS = [
  "/api/env", "/api/config", "/api/admin", "/api/debug",
  "/api/setup", "/api/secret", "/api/keys", "/api/credentials",
  "/.env", "/config.json", "/api/v1", "/api/v2",
  "/wp-admin", "/wp-login.php", "/phpmyadmin", "/admin",
  "/.git/config", "/server-status", "/actuator", "/actuator/env",
];
for (const path of HONEYPOT_PATHS) {
  app.all(path, honeypotTrap);
}

app.use("/api", router);

const frontendRoot = path.resolve(process.cwd(), "artifacts/vps-manager/dist/public");
app.use(express.static(frontendRoot, { index: "index.html", maxAge: "1h" }));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/") && req.accepts("html")) {
    res.sendFile(path.join(frontendRoot, "index.html"));
    return;
  }
  next();
});

export default app;
