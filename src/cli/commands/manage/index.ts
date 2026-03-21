import { Command } from "commander";
import { initSubcommand } from "./init.js";
import { statusSubcommand } from "./status.js";
import { startSubcommand } from "./start.js";
import { stopSubcommand } from "./stop.js";
import { restartSubcommand } from "./restart.js";
import { updateSubcommand } from "./update.js";
import { logsSubcommand } from "./logs.js";
import { backupSubcommand } from "./backup.js";
import { restoreSubcommand } from "./restore.js";
import { sshSubcommand } from "./ssh-cmd.js";
import { cleanupSubcommand } from "./cleanup.js";
import { domainSubcommand } from "./domain.js";
import { envSubcommand } from "./env.js";

export const manageCommand = new Command("manage")
  .description("Manage a remote hookr server via SSH")
  .option("--host <host>", "Server hostname or IP (or set HOOKR_HOST)")
  .option("--key <path>", "SSH private key path (or set HOOKR_SSH_KEY)")
  .option("--user <name>", "SSH user (or set HOOKR_SSH_USER)")
  .option("--dir <path>", "hookr directory on server (or set HOOKR_DIR)");

manageCommand.addCommand(initSubcommand);
manageCommand.addCommand(statusSubcommand);
manageCommand.addCommand(startSubcommand);
manageCommand.addCommand(stopSubcommand);
manageCommand.addCommand(restartSubcommand);
manageCommand.addCommand(updateSubcommand);
manageCommand.addCommand(logsSubcommand);
manageCommand.addCommand(backupSubcommand);
manageCommand.addCommand(restoreSubcommand);
manageCommand.addCommand(sshSubcommand);
manageCommand.addCommand(cleanupSubcommand);
manageCommand.addCommand(domainSubcommand);
manageCommand.addCommand(envSubcommand);
