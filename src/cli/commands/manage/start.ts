import { Command } from "commander";
import chalk from "chalk";
import { requireRemote, waitForHealth } from "./helpers.js";
import { compose } from "../../ssh.js";

export const startSubcommand = new Command("start")
  .description("Start hookd containers")
  .action(async function (this: Command) {
    const remote = requireRemote(this);

    console.log(chalk.blue("==>") + " Starting hookd...");
    const code = await compose(remote, "up -d");
    if (code !== 0) {
      console.error(chalk.red("Failed to start hookd"));
      process.exit(1);
    }
    console.log(chalk.green("==>") + " hookd started\n");
    await waitForHealth(remote.host);
  });
