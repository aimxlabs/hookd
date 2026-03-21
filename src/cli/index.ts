import { Command } from "commander";
import chalk from "chalk";
import { serveCommand } from "./commands/serve.js";
import { channelCommand } from "./commands/channel.js";
import { listenCommand } from "./commands/listen.js";
import { loginCommand } from "./commands/login.js";

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
    console.log("  Quick start:");
    console.log();
    console.log(chalk.dim("  # 1. Start the server"));
    console.log(`  $ ${chalk.cyan("hookr serve")}`);
    console.log();
    console.log(chalk.dim("  # 2. Create a channel"));
    console.log(`  $ ${chalk.cyan('hookr channel create --name my-webhook')}`);
    console.log();
    console.log(chalk.dim("  # 3. Listen for events"));
    console.log(`  $ ${chalk.cyan("hookr listen <channelId> --target http://localhost:3000")}`);
    console.log();
    console.log(chalk.dim("  Run hookr --help for all commands."));
    console.log();
  });

program.addCommand(serveCommand);
program.addCommand(channelCommand);
program.addCommand(listenCommand);
program.addCommand(loginCommand);

export { program };
