import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { serversTable } from "./index";
export { serversTable };
export type InsertServer = InferInsertModel<typeof serversTable>;
export type ServerRecord = InferSelectModel<typeof serversTable>;
