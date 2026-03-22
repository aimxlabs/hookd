import { Command } from "commander";
import chalk from "chalk";
import { requireRemote, waitForHealth } from "./helpers.js";
import { compose } from "../../ssh.js";

export const restartSubcommand = new Command("restart")
  .description("Restart hookd containers")
  .action(async function (this: Command) {
    const remote = requireRemote(this);

    console.log(chalk.blue("==>") + " Restarting hookd...");
    const code = await compose(remote, "restart");
    if (code !== 0) {
      console.error(chalk.red("Failed to restart hookd"));
      process.exit(1);
    }
    console.log(chalk.green("==>") + " hookd restarted\n");
    await waitForHealth(remote.host);
  });
