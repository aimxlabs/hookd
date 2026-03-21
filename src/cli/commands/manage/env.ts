import { Command } from "commander";
import chalk from "chalk";
import { requireRemote } from "./helpers.js";
import { sshExec } from "../../ssh.js";

export const envSubcommand = new Command("env")
  .description("Show current server environment variables")
  .action(async function (this: Command) {
    const remote = requireRemote(this);

    console.log(chalk.blue("==>") + " Current environment:");
    await sshExec(
      remote,
      `cd ${remote.remoteDir} && cat .env 2>/dev/null || echo 'No .env file found'`,
    );
  });
