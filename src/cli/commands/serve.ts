import { Command } from "commander";
import { startServer } from "../../server/index.js";
import {
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_DB_PATH,
} from "../../shared/constants.js";

export const serveCommand = new Command("serve")
  .description("Start the hookr server")
  .option("-p, --port <port>", "Port to listen on", String(DEFAULT_PORT))
  .option("--host <host>", "Host to bind to", DEFAULT_HOST)
  .option("--db <path>", "Path to SQLite database", DEFAULT_DB_PATH)
  .option("--public-url <url>", "Public URL for this server (shown in logs and channel output)")
  .action((opts) => {
    startServer({
      port: parseInt(opts.port, 10),
      host: opts.host,
      dbPath: opts.db,
      publicUrl: opts.publicUrl || process.env.HOOKR_PUBLIC_URL,
    });
  });
