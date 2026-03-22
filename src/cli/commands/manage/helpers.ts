import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolveRemoteConfig, type RemoteConfig } from "../../config.js";

/** Extract remote config from Commander's inherited options. Exits on failure. */
export function requireRemote(cmd: Command): RemoteConfig {
  const opts = cmd.optsWithGlobals();
  const remote = resolveRemoteConfig({
    host: opts.host,
    sshKey: opts.key,
    sshUser: opts.user,
    remoteDir: opts.dir,
  });
  if (!remote) {
    console.error(chalk.red("No remote host configured."));
    console.error(chalk.dim("Pass --host <ip> or run: hookd manage init"));
    process.exit(1);
  }
  return remote;
}

/** Poll /health endpoint until it responds OK. */
export async function waitForHealth(
  host: string,
  maxAttempts = 20,
  intervalMs = 3000,
): Promise<boolean> {
  const spinner = ora("Waiting for health check...").start();
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`https://${host}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        spinner.succeed("hookd is healthy");
        return true;
      }
    } catch {
      try {
        const res = await fetch(`http://${host}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          spinner.succeed("hookd is healthy");
          return true;
        }
      } catch {
        // retry
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  spinner.warn("Health check timed out — hookd may still be starting");
  return false;
}
