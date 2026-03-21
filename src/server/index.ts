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
  publicUrl?: string;
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
      const base = options.publicUrl?.replace(/\/+$/, "") || `http://localhost:${info.port}`;
      const wsBase = base.replace(/^http/, "ws");

      console.log(`hookr server listening on http://${options.host}:${info.port}`);
      console.log();
      console.log(`  Webhook URL: ${base}/h/<channelId>`);
      console.log(`  WebSocket:   ${wsBase}/ws`);
      console.log(`  API:         ${base}/api/channels`);
      console.log(`  Health:      ${base}/health`);

      if (!options.publicUrl) {
        console.log();
        console.log(`  Tip: if this server is publicly accessible, start with:`);
        console.log(`    hookr serve --public-url https://your-domain.com`);
        console.log(`  or set HOOKR_PUBLIC_URL in your environment.`);
      }
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
