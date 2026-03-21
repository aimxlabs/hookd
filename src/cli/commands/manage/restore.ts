import { Command } from "commander";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { requireRemote, waitForHealth } from "./helpers.js";
import { compose, sshExec, scpUpload } from "../../ssh.js";

export const restoreSubcommand = new Command("restore")
  .description("Upload and restore a database backup")
  .argument("<file>", "Path to backup file")
  .action(async function (this: Command, file: string) {
    const remote = requireRemote(this);

    if (!existsSync(file)) {
      console.error(chalk.red(`Backup file not found: ${file}`));
      process.exit(1);
    }

    console.log(chalk.yellow("==>") + " This will replace the current database with the backup.");
    console.log(chalk.yellow("==>") + " The current database will be backed up first.\n");

    const spinner = ora("Uploading backup file...").start();
    const tmp = `/tmp/hookr-restore-${Date.now()}.db`;

    // Upload the backup
    const ulCode = await scpUpload(remote, file, tmp);
    if (ulCode !== 0) {
      spinner.fail("Failed to upload backup file");
      process.exit(1);
    }

    // Stop hookr
    spinner.text = "Stopping hookr...";
    await compose(remote, "stop hookr", {
      stdio: ["ignore", "ignore", "ignore"],
    });

    // Copy into container
    spinner.text = "Restoring database...";
    const cpCode = await sshExec(
      remote,
      `sudo docker cp ${tmp} $(sudo docker compose -f ${remote.remoteDir}/docker-compose.yml ps -q hookr 2>/dev/null || echo hookr-hookr-1):/data/hookr.db`,
      { stdio: ["ignore", "ignore", "ignore"] },
    );

    // Clean up temp file
    await sshExec(remote, `rm -f ${tmp}`, {
      stdio: ["ignore", "ignore", "ignore"],
    });

    if (cpCode !== 0) {
      spinner.fail("Failed to restore database");
      // Try to restart anyway
      await compose(remote, "start hookr", {
        stdio: ["ignore", "ignore", "ignore"],
      });
      process.exit(1);
    }

    // Restart hookr
    spinner.text = "Starting hookr...";
    await compose(remote, "start hookr", {
      stdio: ["ignore", "ignore", "ignore"],
    });

    spinner.succeed(`Database restored from: ${file}`);
    console.log();
    await waitForHealth(remote.host);
  });
