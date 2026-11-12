import app from "./app";
import { logger } from "./lib/logger";
import { ensureDatabase } from "@workspace/db";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isFinite(port) || port <= 0) throw new Error(`Invalid PORT value: "${process.env.PORT ?? ""}"`);

ensureDatabase().then(() => {
  app.listen(port, "0.0.0.0", () => logger.info({ port }, "CFDNS Manager by Lord Eagle listening"));
}).catch((error) => {
  logger.error({ err: error }, "Database initialization failed");
  process.exit(1);
});
