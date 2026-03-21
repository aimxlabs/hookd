import { Command } from "commander";
import chalk from "chalk";
import { saveConfig, loadConfig } from "../config.js";

export const loginCommand = new Command("login")
  .description("Set auth token for connecting to channels")
  .argument("<token>", "Auth token")
  .option("-s, --server <url>", "Server URL to associate with")
  .action((token, opts) => {
    const config = loadConfig();
    config.token = token;
    if (opts.server) config.serverUrl = opts.server;
    saveConfig(config);
    console.log(chalk.green("Token saved to ~/.hookr/config.json"));
  });
