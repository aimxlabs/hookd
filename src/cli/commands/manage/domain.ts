import { Command } from "commander";
import chalk from "chalk";
import { requireRemote, waitForHealth } from "./helpers.js";
import { compose, sshExec } from "../../ssh.js";

export const domainSubcommand = new Command("domain")
  .description("Update the server domain name")
  .argument("<name>", "New domain name")
  .action(async function (this: Command, name: string) {
    const remote = requireRemote(this);

    console.log(chalk.blue("==>") + ` Changing domain to: ${name}`);

    // Update .env on server
    await sshExec(
      remote,
      `cd ${remote.remoteDir} && sudo sed -i 's/HOOKD_DOMAIN=.*/HOOKD_DOMAIN=${name}/' .env`,
      { stdio: ["ignore", "ignore", "ignore"] },
    );

    console.log(chalk.blue("==>") + " Restarting with new domain...");
    await compose(remote, "down", { stdio: ["ignore", "ignore", "ignore"] });
    await compose(remote, "up -d", { stdio: ["ignore", "ignore", "ignore"] });

    console.log(chalk.green("==>") + ` Domain updated to: ${name}`);
    console.log(
      chalk.yellow("\n==>") +
        ` Make sure DNS A record for ${name} points to this server!\n`,
    );
    await waitForHealth(remote.host);
  });
