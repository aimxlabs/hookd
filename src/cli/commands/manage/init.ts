import { Command } from "commander";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { loadConfig, saveConfig } from "../../config.js";
import { homedir } from "node:os";
import { join } from "node:path";

function prompt(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export const initSubcommand = new Command("init")
  .description("Save SSH connection details for remote management")
  .action(async () => {
    const config = loadConfig();
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log(chalk.bold("\nhookd manage — remote configuration\n"));

      const host = await prompt(
        rl,
        `  Server host${config.remoteHost ? chalk.dim(` (${config.remoteHost})`) : ""}: `,
      );
      const sshKey = await prompt(
        rl,
        `  SSH key path${chalk.dim(` (${config.sshKey || join(homedir(), ".ssh", "hookd-deploy-key.pem")})`)}: `,
      );
      const sshUser = await prompt(
        rl,
        `  SSH user${chalk.dim(` (${config.sshUser || "ubuntu"})`)}: `,
      );
      const remoteDir = await prompt(
        rl,
        `  Remote directory${chalk.dim(` (${config.remoteDir || "/opt/hookd"})`)}: `,
      );

      if (host) config.remoteHost = host;
      if (sshKey) config.sshKey = sshKey;
      if (sshUser) config.sshUser = sshUser;
      if (remoteDir) config.remoteDir = remoteDir;

      if (!config.remoteHost && !host) {
        console.error(chalk.red("\n  Host is required."));
        process.exit(1);
      }

      saveConfig(config);

      console.log(
        chalk.green("\n  Configuration saved to ~/.hookd/config.json"),
      );
      console.log(chalk.dim(`\n  Try: hookd manage status\n`));
    } finally {
      rl.close();
    }
  });
