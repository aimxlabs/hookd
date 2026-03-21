import { Command } from "commander";
import chalk from "chalk";
import { resolveServerUrl, resolveToken } from "../config.js";

export const pollCommand = new Command("poll")
  .description("Poll for pending events and output them (cron-friendly)")
  .argument("<channelId>", "Channel ID to poll")
  .option("--token <token>", "Auth token for the channel")
  .option("-t, --target <url>", "Forward events to this URL instead of stdout")
  .option("--limit <n>", "Max events to fetch per poll", "100")
  .option("--after <eventId>", "Only return events after this cursor")
  .option("--no-ack", "Don't acknowledge events after fetching")
  .option("-s, --server <url>", "Server URL")
  .action(async (channelId, opts) => {
    const serverUrl = resolveServerUrl(opts.server);
    const token = resolveToken(opts.token);

    if (!token) {
      console.error(chalk.red("Error: auth token is required for polling."));
      console.error(chalk.dim("Set it with: hookr login <token>, or pass --token, or set HOOKR_TOKEN"));
      process.exit(1);
    }

    // Build poll URL
    const params = new URLSearchParams({ limit: opts.limit });
    if (opts.after) params.set("after", opts.after);

    try {
      const pollRes = await fetch(
        `${serverUrl}/api/channels/${channelId}/poll?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!pollRes.ok) {
        const err = (await pollRes.json()) as any;
        console.error(chalk.red(`Error: ${err.error || pollRes.statusText}`));
        process.exit(1);
      }

      const { events, cursor } = (await pollRes.json()) as {
        events: any[];
        cursor: string | null;
      };

      if (events.length === 0) {
        // Silent exit for cron — nothing to do
        process.exit(0);
      }

      const eventIds: string[] = [];

      for (const evt of events) {
        if (opts.target) {
          // Forward mode: POST to target URL
          try {
            const start = Date.now();
            const res = await fetch(opts.target, {
              method: "POST",
              headers: {
                "Content-Type":
                  evt.headers["content-type"] || "application/json",
                "X-Hookr-Event-Id": evt.id,
                "X-Hookr-Channel-Id": evt.channelId,
              },
              body: evt.body,
              signal: AbortSignal.timeout(30_000),
            });
            const elapsed = Date.now() - start;
            console.log(
              chalk.dim(`[${new Date().toLocaleTimeString()}]`),
              chalk.cyan(evt.id),
              res.ok
                ? chalk.green(`${res.status} (${elapsed}ms)`)
                : chalk.red(`${res.status} (${elapsed}ms)`),
            );
            if (res.ok) eventIds.push(evt.id);
          } catch (err: any) {
            console.error(
              chalk.dim(`[${new Date().toLocaleTimeString()}]`),
              chalk.cyan(evt.id),
              chalk.red(`FAILED: ${err.message}`),
            );
          }
        } else {
          // JSON mode: output each event as a JSON line
          console.log(JSON.stringify(evt));
          eventIds.push(evt.id);
        }
      }

      // Acknowledge delivered events
      if (opts.ack !== false && eventIds.length > 0) {
        try {
          await fetch(`${serverUrl}/api/channels/${channelId}/ack`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ eventIds }),
            signal: AbortSignal.timeout(10_000),
          });
        } catch {
          console.error(
            chalk.yellow("Warning: failed to acknowledge events"),
          );
        }
      }

      // Print cursor to stderr so stdout stays clean for JSON piping
      if (cursor) {
        process.stderr.write(`cursor:${cursor}\n`);
      }
    } catch (err: any) {
      console.error(chalk.red(`Failed to connect to server at ${serverUrl}`));
      console.error(
        chalk.dim("Is the server running? Start it with: hookr serve"),
      );
      process.exit(1);
    }
  });
