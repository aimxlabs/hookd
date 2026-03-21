import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { requireRemote } from "./helpers.js";
import { compose, sshCapture } from "../../ssh.js";

export const statusSubcommand = new Command("status")
  .description("Show server status, container health, and disk usage")
  .action(async function (this: Command) {
    const remote = requireRemote(this);

    console.log(chalk.bold("\nhookr server status"));
    console.log(chalk.dim(`  Host: ${remote.host}\n`));

    // Container status
    console.log(chalk.blue("==>") + " Container status:");
    const psCode = await compose(remote, "ps");
    if (psCode !== 0) {
      console.error(chalk.red("Could not connect to server"));
      process.exit(1);
    }
    console.log();

    // Health check
    const spinner = ora("Health check...").start();
    let healthy = false;
    try {
      const res = await fetch(`https://${remote.host}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        spinner.succeed(`Healthy: ${await res.text()}`);
        healthy = true;
      }
    } catch {
      try {
        const res = await fetch(`http://${remote.host}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          spinner.succeed(`Healthy: ${await res.text()}`);
          healthy = true;
        }
      } catch {
        // fall through
      }
    }
    if (!healthy) spinner.warn("Health endpoint unreachable");
    console.log();

    // Disk usage
    console.log(chalk.blue("==>") + " Disk usage:");
    const disk = await sshCapture(
      remote,
      `df -h / | tail -1 | awk '{print "  " $3 " used / " $2 " total (" $5 " full)"}'`,
    );
    if (disk.code === 0) console.log(disk.stdout.trimEnd());
    console.log();

    // Docker disk usage
    console.log(chalk.blue("==>") + " Docker disk usage:");
    await compose(remote, "ps --format '{{.Name}}: up {{.RunningFor}}'", {
      stdio: "inherit",
    });
    console.log();
  });
