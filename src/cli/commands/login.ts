import { Command } from "commander";
import chalk from "chalk";
import { saveConfig, loadConfig } from "../config.js";

export const loginCommand = new Command("login")
  .description("Save server URL and auth token so you don't have to pass them every time")
  .argument("<token>", "Auth token (from hookr channel create)")
  .option("-s, --server <url>", "Server URL (e.g. https://hookr.example.com)")
  .action((token, opts) => {
    const config = loadConfig();
    config.token = token;
    if (opts.server) config.serverUrl = opts.server;
    saveConfig(config);

    console.log(chalk.green("Saved to ~/.hookr/config.json"));
    if (config.serverUrl) {
      console.log(`  ${chalk.bold("Server:")} ${config.serverUrl}`);
    } else {
      console.log(
        chalk.yellow("  Tip: pass -s <url> to save your server URL too, e.g.:"),
      );
      console.log(
        chalk.dim("  hookr login <token> -s https://hookr.example.com"),
      );
    }
    console.log(`  ${chalk.bold("Token:")}  ${token.slice(0, 8)}...`);
    console.log();
    console.log(chalk.dim("All commands will now use these defaults automatically."));
  });
