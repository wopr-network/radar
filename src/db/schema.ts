import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull(),
  config: text("config").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const watches = sqliteTable("watches", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filter: text("filter").notNull(),
  action: text("action").notNull(),
  actionConfig: text("action_config").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const eventLog = sqliteTable("event_log", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  watchId: text("watch_id").references(() => watches.id, { onDelete: "cascade" }),
  rawEvent: text("raw_event").notNull(),
  actionTaken: text("action_taken"),
  defconResponse: text("defcon_response"),
  createdAt: integer("created_at").notNull(),
});

export const workers = sqliteTable("workers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  discipline: text("discipline").notNull(),
  status: text("status").notNull().default("idle"),
  config: text("config"),
  lastHeartbeat: integer("last_heartbeat").notNull(),
  createdAt: integer("created_at").notNull(),
});
