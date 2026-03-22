import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { requireRemote } from "./helpers.js";
import { compose, sshExec, scpDownload } from "../../ssh.js";

export const backupSubcommand = new Command("backup")
  .description("Download a backup of the hookd database")
  .option("--output <path>", "Local path for backup file")
  .action(async function (this: Command) {
    const remote = requireRemote(this);
    const opts = this.opts();
    const timestamp = new Date()
      .toISOString()
      .replace(/[T:]/g, "-")
      .replace(/\..+/, "");
    const output = opts.output || `hookd-backup-${timestamp}.db`;

    const spinner = ora("Creating database backup...").start();

    // Stop hookd briefly for clean backup
    spinner.text = "Stopping hookd for clean backup...";
    await compose(remote, "stop hookd", {
      stdio: ["ignore", "ignore", "ignore"],
    });

    // Copy DB from container/volume to temp path on server
    const tmp = `/tmp/hookd-backup-${Date.now()}.db`;
    const copyCode = await sshExec(
      remote,
      `sudo docker cp $(sudo docker compose -f ${remote.remoteDir}/docker-compose.yml ps -q hookd 2>/dev/null || echo hookd-hookd-1):/data/hookd.db ${tmp} 2>/dev/null || sudo cp /var/lib/docker/volumes/hookd_hookd-data/_data/hookd.db ${tmp}`,
      { stdio: ["ignore", "ignore", "ignore"] },
    );

    // Restart hookd immediately
    spinner.text = "Restarting hookd...";
    await compose(remote, "start hookd", {
      stdio: ["ignore", "ignore", "ignore"],
    });

    if (copyCode !== 0) {
      spinner.fail("Failed to copy database on server");
      process.exit(1);
    }

    // Download via SCP
    spinner.text = "Downloading backup...";
    const dlCode = await scpDownload(remote, tmp, output);

    // Clean up remote temp file
    await sshExec(remote, `rm -f ${tmp}`, {
      stdio: ["ignore", "ignore", "ignore"],
    });

    if (dlCode !== 0) {
      spinner.fail("Failed to download backup");
      process.exit(1);
    }

    spinner.succeed(`Backup saved to: ${output}`);
  });
