import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline";
import { saveConfig, loadConfig, resolveServerUrl } from "../config.js";

function prompt(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export const setupCommand = new Command("setup")
  .description(
    "Guided setup — connect to your hookd server and create a trigger channel",
  )
  .option("-s, --server <url>", "Server URL (skip the prompt)")
  .option("--admin-token <token>", "Admin token (or set HOOKD_ADMIN_TOKEN)")
  .action(async (opts) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log();
    console.log(chalk.bold("  hookd setup"));
    console.log(
      chalk.dim(
        "  This will connect you to your hookd server and create a trigger channel.",
      ),
    );
    console.log();

    // Step 1: Server URL
    let serverUrl = opts.server;
    if (!serverUrl) {
      const saved = loadConfig().serverUrl;
      if (saved) {
        console.log(chalk.dim(`  Current server: ${saved}`));
        const answer = await prompt(rl, `  Server URL [${saved}]: `);
        serverUrl = answer.trim() || saved;
      } else {
        console.log(chalk.dim("  Where is your hookd server running?"));
        console.log(
          chalk.dim(
            "  Examples: https://hookd.example.com, http://my-ec2:4801",
          ),
        );
        console.log();
        serverUrl = (await prompt(rl, "  Server URL: ")).trim();
      }
    }

    if (!serverUrl) {
      console.error(chalk.red("\n  Server URL is required."));
      rl.close();
      process.exit(1);
    }

    // Remove trailing slash
    serverUrl = serverUrl.replace(/\/+$/, "");

    // Step 2: Test connection
    console.log();
    console.log(chalk.dim(`  Testing connection to ${serverUrl}...`));

    try {
      const res = await fetch(`${serverUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(chalk.green("  Connected!"));
    } catch (err: any) {
      console.error(chalk.red(`  Could not connect to ${serverUrl}`));
      console.error(chalk.dim(`  Error: ${err.message}`));
      console.log();
      console.log(chalk.dim("  Make sure:"));
      console.log(chalk.dim("  1. The hookd server is running (hookd serve)"));
      console.log(
        chalk.dim("  2. The URL is correct and reachable from this machine"),
      );
      console.log(
        chalk.dim(
          "  3. Any firewall or security group allows traffic on this port",
        ),
      );
      rl.close();
      process.exit(1);
    }

    // Step 3: Create a channel
    console.log();
    const channelName =
      (await prompt(rl, "  Channel name (e.g. my-agent): ")).trim() ||
      "my-agent";

    console.log();
    console.log(
      chalk.dim(
        "  Will this channel receive webhooks from a known provider (GitHub, Stripe, Slack)?",
      ),
    );
    console.log(
      chalk.dim(
        "  If so, you can enable signature verification. Otherwise, just press Enter.",
      ),
    );
    console.log();
    console.log(chalk.dim("  1) No — generic HTTP trigger (default)"));
    console.log(chalk.dim("  2) Yes — GitHub webhooks"));
    console.log(chalk.dim("  3) Yes — Stripe webhooks"));
    console.log(chalk.dim("  4) Yes — Slack webhooks"));
    const providerChoice = (await prompt(rl, "  Choice [1]: ")).trim() || "1";

    const providerMap: Record<string, string | undefined> = {
      "1": undefined,
      "2": "github",
      "3": "stripe",
      "4": "slack",
    };
    const provider = providerMap[providerChoice] ?? undefined;

    let secret: string | undefined;
    if (provider) {
      console.log();
      console.log(
        chalk.dim(
          `  Enter your ${provider} webhook signing secret for signature verification.`,
        ),
      );
      console.log(
        chalk.dim(
          "  Leave blank to skip verification (not recommended for production).",
        ),
      );
      secret = (await prompt(rl, "  Signing secret: ")).trim() || undefined;
    }

    rl.close();

    // Create the channel
    try {
      const createBody: Record<string, string> = { name: channelName };
      if (provider) createBody.provider = provider;
      if (secret) createBody.secret = secret;

      const adminToken = opts.adminToken || process.env.HOOKD_ADMIN_TOKEN;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (adminToken) {
        headers["Authorization"] = `Bearer ${adminToken}`;
      }

      const res = await fetch(`${serverUrl}/api/channels`, {
        method: "POST",
        headers,
        body: JSON.stringify(createBody),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const err = (await res.json()) as any;
        console.error(
          chalk.red(
            `\n  Failed to create channel: ${err.error || res.statusText}`,
          ),
        );
        if (res.status === 401) {
          console.error(
            chalk.dim("  Hint: set HOOKD_ADMIN_TOKEN or pass --admin-token"),
          );
        }
        process.exit(1);
      }

      const channel = (await res.json()) as any;

      // Save config
      const config = loadConfig();
      config.serverUrl = serverUrl;
      config.token = channel.authToken;
      saveConfig(config);

      // Show results
      const webhookUrl = `${serverUrl}/h/${channel.id}`;

      console.log();
      console.log(chalk.green.bold("  Setup complete!"));
      console.log();
      console.log(`  ${chalk.bold("Channel ID:")}  ${channel.id}`);
      console.log(`  ${chalk.bold("Webhook URL:")} ${webhookUrl}`);
      console.log(`  ${chalk.bold("Auth Token:")}  ${channel.authToken}`);
      console.log();

      // Next steps
      if (provider === "github") {
        console.log(chalk.bold("  Configure GitHub:"));
        console.log();
        console.log(
          "  1. Go to your GitHub repo → Settings → Webhooks → Add webhook",
        );
        console.log(`  2. Set Payload URL to: ${chalk.cyan(webhookUrl)}`);
        console.log("  3. Set Content type to: application/json");
        if (secret) {
          console.log(
            `  4. Set Secret to the same signing secret you entered above`,
          );
        }
        console.log();
      } else if (provider === "stripe") {
        console.log(chalk.bold("  Configure Stripe:"));
        console.log();
        console.log(
          "  1. Go to Stripe Dashboard → Developers → Webhooks → Add endpoint",
        );
        console.log(`  2. Set Endpoint URL to: ${chalk.cyan(webhookUrl)}`);
        console.log("  3. Select the events you want to receive");
        console.log();
      } else if (provider === "slack") {
        console.log(chalk.bold("  Configure Slack:"));
        console.log();
        console.log(
          "  1. Go to api.slack.com → Your App → Event Subscriptions",
        );
        console.log(`  2. Set Request URL to: ${chalk.cyan(webhookUrl)}`);
        console.log();
      } else {
        console.log(chalk.bold("  Trigger your agent:"));
        console.log();
        console.log(
          chalk.cyan(
            `  curl -X POST ${webhookUrl} \\`,
          ),
        );
        console.log(
          chalk.cyan(
            `    -H "Content-Type: application/json" \\`,
          ),
        );
        console.log(
          chalk.cyan(
            `    -d '{"event": "hello", "data": {"message": "world"}}'`,
          ),
        );
        console.log();
        console.log(
          chalk.dim(
            "  Any HTTP POST to this URL will be forwarded to your agent.",
          ),
        );
        console.log();
      }

      console.log(`  Start receiving events locally:`);
      console.log();
      console.log(chalk.cyan(`  hookd listen ${channel.id}`));
      console.log();
      console.log(
        chalk.dim("  Or poll via cron (no persistent connection needed):"),
      );
      console.log(chalk.cyan(`  hookd poll ${channel.id}`));
      console.log();
      console.log(
        chalk.dim(
          "  Your server URL and token have been saved — no need to pass them again.",
        ),
      );
    } catch (err: any) {
      console.error(chalk.red(`\n  Failed to connect: ${err.message}`));
      process.exit(1);
    }
  });
