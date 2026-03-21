import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider"),
  secret: text("secret"),
  callbackUrl: text("callback_url"),
  authToken: text("auth_token").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    headers: text("headers").notNull(), // JSON string
    body: text("body").notNull(),
    method: text("method").notNull(),
    sourceIp: text("source_ip").notNull(),
    receivedAt: integer("received_at").notNull(),
    deliveredAt: integer("delivered_at"),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [
    index("idx_events_channel_received").on(
      table.channelId,
      table.receivedAt,
    ),
    index("idx_events_undelivered").on(table.deliveredAt),
  ],
);
