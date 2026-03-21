import { Command } from "commander";
import chalk from "chalk";
import { requireRemote } from "./helpers.js";
import { sshExec } from "../../ssh.js";

export const cleanupSubcommand = new Command("cleanup")
  .description("Remove unused Docker images, volumes, and build cache")
  .action(async function (this: Command) {
    const remote = requireRemote(this);

    console.log(chalk.blue("==>") + " Removing unused images...");
    await sshExec(remote, "sudo docker image prune -af", {
      stdio: ["ignore", "ignore", "ignore"],
    });

    console.log(chalk.blue("==>") + " Removing unused volumes...");
    await sshExec(remote, "sudo docker volume prune -f", {
      stdio: ["ignore", "ignore", "ignore"],
    });

    console.log(chalk.blue("==>") + " Removing build cache...");
    await sshExec(remote, "sudo docker builder prune -af", {
      stdio: ["ignore", "ignore", "ignore"],
    });

    console.log();
    console.log(chalk.blue("==>") + " Docker disk usage after cleanup:");
    await sshExec(remote, "sudo docker system df");

    console.log(chalk.green("\n==>") + " Cleanup complete");
  });
