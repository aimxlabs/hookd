import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import { initDb, closeDb } from "../db/index.js";
import webhookRoutes from "./routes/webhook.js";
import apiRoutes from "./routes/api.js";
import healthRoutes from "./routes/health.js";
import { handleWsOpen, handleWsMessage, handleWsClose } from "./ws.js";
import { startDeliveryWorkers, stopDeliveryWorkers } from "./delivery.js";

export interface ServerOptions {
  port: number;
  host: string;
  dbPath: string;
}

export function createApp() {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // WebSocket endpoint
  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(evt, ws) {
        handleWsOpen(ws);
      },
      onMessage(evt, ws) {
        handleWsMessage(ws, typeof evt.data === "string" ? evt.data : evt.data.toString());
      },
      onClose(evt, ws) {
        handleWsClose(ws);
      },
    })),
  );

  // HTTP routes
  app.route("/", webhookRoutes);
  app.route("/", apiRoutes);
  app.route("/", healthRoutes);

  return { app, injectWebSocket };
}

export function startServer(options: ServerOptions) {
  // Initialize database
  initDb(options.dbPath);

  const { app, injectWebSocket } = createApp();

  const server = serve(
    {
      fetch: app.fetch,
      port: options.port,
      hostname: options.host,
    },
    (info) => {
      console.log(`hookr server listening on http://${options.host}:${info.port}`);
      console.log(`Webhook URL: http://localhost:${info.port}/h/<channelId>`);
      console.log(`WebSocket:   ws://localhost:${info.port}/ws`);
      console.log(`API:         http://localhost:${info.port}/api/channels`);
    },
  );

  injectWebSocket(server);
  startDeliveryWorkers();

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    stopDeliveryWorkers();
    server.close();
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}
