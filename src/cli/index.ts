import { Command } from "commander";
import chalk from "chalk";
import { serveCommand } from "./commands/serve.js";
import { channelCommand } from "./commands/channel.js";
import { listenCommand } from "./commands/listen.js";
import { loginCommand } from "./commands/login.js";
import { pollCommand } from "./commands/poll.js";
import { setupCommand } from "./commands/setup.js";
import { manageCommand } from "./commands/manage/index.js";
import { deployCommand } from "./commands/deploy/index.js";

const program = new Command();

program
  .name("hookr")
  .description("Webhook relay for AI agents")
  .version("0.1.0")
  .action(() => {
    // Default action when no command is provided
    console.log();
    console.log(chalk.bold("  hookr") + chalk.dim(" — webhook relay for AI agents"));
    console.log();
    console.log("  Get started:");
    console.log();
    console.log(chalk.dim("  # On your server (AWS, VPS, etc.)"));
    console.log(`  $ ${chalk.cyan("hookr serve")}`);
    console.log();
    console.log(chalk.dim("  # On your local machine — guided setup"));
    console.log(`  $ ${chalk.cyan("hookr setup")}`);
    console.log();
    console.log(chalk.dim("  # Or do it manually"));
    console.log(`  $ ${chalk.cyan("hookr login <token> -s https://your-server.com")}`);
    console.log(`  $ ${chalk.cyan("hookr listen <channelId>")}`);
    console.log();
    console.log(chalk.dim("  Run hookr --help for all commands."));
    console.log();
  });

program.addCommand(serveCommand);
program.addCommand(channelCommand);
program.addCommand(listenCommand);
program.addCommand(loginCommand);
program.addCommand(pollCommand);
program.addCommand(setupCommand);
program.addCommand(manageCommand);
program.addCommand(deployCommand);

export { program };
