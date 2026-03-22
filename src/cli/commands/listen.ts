import { Command } from "commander";
import WebSocket from "ws";
import chalk from "chalk";
import {
  WS_RECONNECT_BASE_MS,
  WS_RECONNECT_MAX_MS,
} from "../../shared/constants.js";
import type { ServerMessage } from "../../shared/protocol.js";
import { resolveServerUrl, resolveToken } from "../config.js";

export const listenCommand = new Command("listen")
  .description("Connect to a channel and forward webhook events to a local URL")
  .argument("<channelId>", "Channel ID to listen on")
  .option(
    "-t, --target <url>",
    "Local URL to forward events to",
    "http://localhost:3000",
  )
  .option("--json", "Output raw JSON to stdout instead of forwarding")
  .option("--token <token>", "Auth token for the channel")
  .option("-s, --server <url>", "Server URL")
  .action((channelId, opts) => {
    const serverUrl = resolveServerUrl(opts.server);
    const token = resolveToken(opts.token);
    const wsUrl = serverUrl.replace(/^http/, "ws") + "/ws";

    let reconnectDelay = WS_RECONNECT_BASE_MS;
    let shouldReconnect = true;

    function connect() {
      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        reconnectDelay = WS_RECONNECT_BASE_MS;
        console.log(chalk.green("Connected to hookd server."));

        // Authenticate
        if (token) {
          ws.send(JSON.stringify({ type: "auth", token }));
        }

        // Subscribe to channel
        ws.send(JSON.stringify({ type: "subscribe", channelId }));
      });

      ws.on("message", async (data) => {
        const msg: ServerMessage = JSON.parse(data.toString());

        switch (msg.type) {
          case "auth_ok":
            break;

          case "auth_error":
            console.error(chalk.red(`Auth error: ${msg.message}`));
            shouldReconnect = false;
            ws.close();
            process.exit(1);
            break;

          case "subscribed":
            if (opts.json) {
              console.log(
                chalk.green(`Listening on ${msg.channelId} (JSON mode)`),
              );
            } else {
              console.log(
                chalk.green(`Listening on ${msg.channelId}`),
                chalk.dim(`→ forwarding to ${opts.target}`),
              );
            }
            break;

          case "event": {
            const time = new Date().toLocaleTimeString();

            if (opts.json) {
              // Output raw event as JSON line
              console.log(JSON.stringify(msg));
            } else {
              // Forward to local target
              try {
                const start = Date.now();
                const res = await fetch(opts.target, {
                  method: "POST",
                  headers: {
                    "Content-Type":
                      msg.headers["content-type"] || "application/json",
                    "X-Hookd-Event-Id": msg.eventId,
                    "X-Hookd-Channel-Id": msg.channelId,
                  },
                  body: msg.body,
                  signal: AbortSignal.timeout(30_000),
                });
                const elapsed = Date.now() - start;
                console.log(
                  chalk.dim(`[${time}]`),
                  chalk.bold(msg.method),
                  `from ${msg.ip}`,
                  chalk.dim("—"),
                  res.ok
                    ? chalk.green(`${res.status} (${elapsed}ms)`)
                    : chalk.red(`${res.status} (${elapsed}ms)`),
                );
              } catch (err: any) {
                console.log(
                  chalk.dim(`[${time}]`),
                  chalk.bold(msg.method),
                  `from ${msg.ip}`,
                  chalk.dim("—"),
                  chalk.red(`FAILED: ${err.message}`),
                );
              }
            }

            // Acknowledge receipt
            ws.send(JSON.stringify({ type: "ack", eventId: msg.eventId }));
            break;
          }

          case "error":
            console.error(chalk.red(`Server error: ${msg.message}`));
            break;

          case "pong":
            break;
        }
      });

      ws.on("close", () => {
        if (!shouldReconnect) return;

        console.log(
          chalk.yellow(
            `Disconnected. Reconnecting in ${Math.round(reconnectDelay / 1000)}s...`,
          ),
        );
        setTimeout(() => {
          // Add jitter (±25%)
          const jitter = reconnectDelay * 0.25 * (Math.random() * 2 - 1);
          reconnectDelay = Math.min(
            reconnectDelay * 2 + jitter,
            WS_RECONNECT_MAX_MS,
          );
          connect();
        }, reconnectDelay);
      });

      ws.on("error", (err) => {
        // Error will be followed by close event
        if ((err as any).code === "ECONNREFUSED") {
          // Suppress noisy error — the close handler will manage reconnection
        } else {
          console.error(chalk.red(`WebSocket error: ${err.message}`));
        }
      });

      // Keepalive ping every 25 seconds
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 25_000);

      ws.on("close", () => clearInterval(pingInterval));
    }

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      shouldReconnect = false;
      console.log(chalk.dim("\nDisconnecting..."));
      process.exit(0);
    });

    connect();
  });
