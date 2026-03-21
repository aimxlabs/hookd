import { Command } from "commander";
import chalk from "chalk";
import { resolveServerUrl } from "../config.js";

export const channelCommand = new Command("channel")
  .description("Manage webhook channels");

channelCommand
  .command("create")
  .description("Create a new webhook channel")
  .requiredOption("-n, --name <name>", "Channel name")
  .option("--provider <provider>", "Webhook provider (github, stripe, slack, generic)")
  .option("--secret <secret>", "Webhook signing secret")
  .option("--callback-url <url>", "HTTP fallback URL for delivery")
  .option("-s, --server <url>", "Server URL")
  .action(async (opts) => {
    const baseUrl = resolveServerUrl(opts.server);
    try {
      const res = await fetch(`${baseUrl}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: opts.name,
          provider: opts.provider,
          secret: opts.secret,
          callbackUrl: opts.callbackUrl,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error(chalk.red(`Error: ${err.error || res.statusText}`));
        process.exit(1);
      }

      const channel = await res.json() as any;
      console.log(chalk.green("Channel created!"));
      console.log();
      console.log(`  ${chalk.bold("ID:")}          ${channel.id}`);
      console.log(`  ${chalk.bold("Name:")}        ${channel.name}`);
      console.log(`  ${chalk.bold("Webhook URL:")} ${baseUrl}/h/${channel.id}`);
      console.log(`  ${chalk.bold("Auth Token:")}  ${channel.authToken}`);
      if (channel.provider) {
        console.log(`  ${chalk.bold("Provider:")}    ${channel.provider}`);
      }
      console.log();
      console.log(chalk.dim("Copy the webhook URL to your provider's webhook settings."));
      console.log(chalk.dim(`Listen with: hookr listen ${channel.id}`));
    } catch (err: any) {
      console.error(chalk.red(`Failed to connect to server at ${baseUrl}`));
      console.error(chalk.dim("Is the server running? Start it with: hookr serve"));
      process.exit(1);
    }
  });

channelCommand
  .command("list")
  .description("List all channels")
  .option("-s, --server <url>", "Server URL")
  .action(async (opts) => {
    const baseUrl = resolveServerUrl(opts.server);
    try {
      const res = await fetch(`${baseUrl}/api/channels`);
      const channels = await res.json() as any[];

      if (channels.length === 0) {
        console.log(chalk.dim("No channels found. Create one with: hookr channel create -n <name>"));
        return;
      }

      console.log(chalk.bold(`Channels (${channels.length}):\n`));
      for (const ch of channels) {
        const age = timeAgo(ch.createdAt);
        console.log(
          `  ${chalk.cyan(ch.id)}  ${ch.name}${ch.provider ? chalk.dim(` [${ch.provider}]`) : ""}  ${chalk.dim(age)}`,
        );
      }
    } catch {
      console.error(chalk.red(`Failed to connect to server at ${baseUrl}`));
      process.exit(1);
    }
  });

channelCommand
  .command("delete <id>")
  .description("Delete a channel")
  .option("-s, --server <url>", "Server URL")
  .action(async (id, opts) => {
    const baseUrl = resolveServerUrl(opts.server);
    try {
      const res = await fetch(`${baseUrl}/api/channels/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json();
        console.error(chalk.red(`Error: ${err.error || res.statusText}`));
        process.exit(1);
      }

      console.log(chalk.green(`Channel ${id} deleted.`));
    } catch {
      console.error(chalk.red(`Failed to connect to server at ${baseUrl}`));
      process.exit(1);
    }
  });

channelCommand
  .command("inspect <id>")
  .description("Show recent events for a channel")
  .option("-l, --limit <n>", "Number of events to show", "10")
  .option("-s, --server <url>", "Server URL")
  .action(async (id, opts) => {
    const baseUrl = resolveServerUrl(opts.server);
    try {
      const res = await fetch(
        `${baseUrl}/api/channels/${id}/events?limit=${opts.limit}`,
      );
      const events = await res.json() as any[];

      if (events.length === 0) {
        console.log(chalk.dim("No events found for this channel."));
        return;
      }

      console.log(chalk.bold(`Recent events for ${id}:\n`));
      for (const evt of events) {
        const time = new Date(evt.receivedAt * 1000).toISOString();
        const status = evt.deliveredAt
          ? chalk.green("delivered")
          : chalk.yellow(`pending (${evt.attempts} attempts)`);
        console.log(`  ${chalk.dim(time)}  ${chalk.cyan(evt.id)}  ${evt.method}  ${status}`);
      }
    } catch {
      console.error(chalk.red(`Failed to connect to server at ${baseUrl}`));
      process.exit(1);
    }
  });

function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
