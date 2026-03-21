import { Command } from "commander";
import chalk from "chalk";
import { requireRemote, waitForHealth } from "./helpers.js";
import { compose } from "../../ssh.js";

export const restartSubcommand = new Command("restart")
  .description("Restart hookr containers")
  .action(async function (this: Command) {
    const remote = requireRemote(this);

    console.log(chalk.blue("==>") + " Restarting hookr...");
    const code = await compose(remote, "restart");
    if (code !== 0) {
      console.error(chalk.red("Failed to restart hookr"));
      process.exit(1);
    }
    console.log(chalk.green("==>") + " hookr restarted\n");
    await waitForHealth(remote.host);
  });
