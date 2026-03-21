import { Command } from "commander";
import chalk from "chalk";
import { requireRemote } from "./helpers.js";
import { sshInteractive } from "../../ssh.js";

export const sshSubcommand = new Command("ssh")
  .description("Open an SSH session to the server")
  .action(async function (this: Command) {
    const remote = requireRemote(this);

    console.log(chalk.blue("==>") + ` Connecting to ${remote.host}...`);
    const code = await sshInteractive(remote);
    process.exit(code);
  });
