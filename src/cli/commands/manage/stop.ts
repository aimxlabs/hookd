import { Command } from "commander";
import chalk from "chalk";
import { requireRemote } from "./helpers.js";
import { compose } from "../../ssh.js";

export const stopSubcommand = new Command("stop")
  .description("Stop hookr containers")
  .action(async function (this: Command) {
    const remote = requireRemote(this);

    console.log(chalk.blue("==>") + " Stopping hookr...");
    const code = await compose(remote, "down");
    if (code !== 0) {
      console.error(chalk.red("Failed to stop hookr"));
      process.exit(1);
    }
    console.log(chalk.green("==>") + " hookr stopped");
  });
