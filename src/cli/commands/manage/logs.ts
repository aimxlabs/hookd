import { Command } from "commander";
import chalk from "chalk";
import { requireRemote } from "./helpers.js";
import { compose } from "../../ssh.js";

export const logsSubcommand = new Command("logs")
  .description("View container logs (follows by default)")
  .option("--lines <n>", "Number of lines to show", "100")
  .option("--no-follow", "Don't follow log output")
  .option("--service <name>", "Specific service to show logs for")
  .action(async function (this: Command) {
    const remote = requireRemote(this);
    const opts = this.opts();
    const lines = opts.lines;
    const follow = opts.follow !== false;
    const service = opts.service || "";

    if (follow) {
      console.log(
        chalk.blue("==>") +
          ` Showing last ${lines} lines, following... (Ctrl+C to stop)`,
      );
    }

    const followFlag = follow ? " -f" : "";
    const code = await compose(
      remote,
      `logs --tail ${lines}${followFlag} ${service}`.trim(),
    );
    if (code !== 0 && code !== 130) {
      // 130 = SIGINT (Ctrl+C), expected for follow mode
      process.exit(code);
    }
  });
