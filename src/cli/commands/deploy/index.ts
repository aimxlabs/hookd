import { Command } from "commander";
import { awsSubcommand } from "./aws.js";
import { digitaloceanSubcommand } from "./digitalocean.js";
import { teardownSubcommand } from "./teardown.js";

export const deployCommand = new Command("deploy")
  .description("Provision or tear down a cloud hookd server")
  .addCommand(awsSubcommand)
  .addCommand(digitaloceanSubcommand)
  .addCommand(teardownSubcommand);
