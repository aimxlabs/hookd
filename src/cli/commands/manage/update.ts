import { Command } from "commander";
import chalk from "chalk";
import { requireRemote, waitForHealth } from "./helpers.js";
import { compose, sshExec } from "../../ssh.js";

export const updateSubcommand = new Command("update")
  .description("Pull latest code, rebuild, and restart")
  .action(async function (this: Command) {
    const remote = requireRemote(this);

    console.log(chalk.blue("==>") + " Pulling latest code...");
    const pullCode = await sshExec(
      remote,
      `cd ${remote.remoteDir} && sudo git pull`,
    );
    if (pullCode !== 0) {
      console.error(chalk.red("Failed to pull latest code"));
      process.exit(1);
    }

    console.log(chalk.blue("==>") + " Rebuilding containers...");
    const buildCode = await compose(remote, "up -d --build");
    if (buildCode !== 0) {
      console.error(chalk.red("Failed to rebuild containers"));
      process.exit(1);
    }

    console.log(chalk.blue("==>") + " Cleaning up old images...");
    await sshExec(remote, "sudo docker image prune -f", {
      stdio: ["ignore", "ignore", "ignore"],
    });

    console.log(chalk.green("==>") + " hookr updated\n");
    await waitForHealth(remote.host);
  });
