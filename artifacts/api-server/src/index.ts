import app from "./app";
import { logger } from "./lib/logger";
import { ensureDatabase } from "@workspace/db";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
if (!Number.isFinite(port) || port <= 0) throw new Error(`Invalid PORT value: "${process.env.PORT ?? ""}"`);

ensureDatabase().then(() => {
  app.listen(port, host, () => logger.info({ port, host }, "CFDNS Manager by Lord Eagle listening"));
}).catch((error) => {
  logger.error({ err: error }, "Database initialization failed");
  process.exit(1);
});
