import { Command } from "commander";
import { awsSubcommand } from "./aws.js";
import { digitaloceanSubcommand } from "./digitalocean.js";

export const deployCommand = new Command("deploy")
  .description("Provision a new cloud server and deploy hookr")
  .addCommand(awsSubcommand)
  .addCommand(digitaloceanSubcommand);
