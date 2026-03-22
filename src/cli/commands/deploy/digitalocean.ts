import { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { execSync } from "node:child_process";
import {
  cloudInitScript,
  run,
  runInherit,
  waitForHealthIP,
} from "./helpers.js";

export const digitaloceanSubcommand = new Command("digitalocean")
  .alias("do")
  .description("Deploy hookd to a DigitalOcean Droplet (~$6/month, ~3 min)")
  .argument("<domain>", "Domain name (e.g. hookd.example.com)")
  .argument("[region]", "Droplet region", "nyc1")
  .option("--size <size>", "Droplet size slug", "s-1vcpu-1gb")
  .option("--name <name>", "Droplet name", "hookd-server")
  .option(
    "--repo <url>",
    "Git repository URL for hookd source",
    "https://github.com/aimxlabs/hookd.git",
  )
  .action(async (domain: string, region: string, opts) => {
    const { size, name, repo } = opts;

    console.log();
    console.log(chalk.bold("==>") + " Deploying hookd to DigitalOcean");
    console.log(`    Domain: ${domain}`);
    console.log(`    Region: ${region}`);
    console.log(`    Size:   ${size}`);
    console.log();

    // ── Step 1: SSH Key ────────────────────────────────────────────
    process.stdout.write(chalk.blue("==>") + " Setting up SSH key...\n");
    const keyFile = join(homedir(), ".ssh", "hookd-deploy-key");
    const pubKeyFile = `${keyFile}.pub`;

    if (!existsSync(keyFile)) {
      const genCode = await runInherit("ssh-keygen", [
        "-t",
        "ed25519",
        "-f",
        keyFile,
        "-N",
        "",
        "-C",
        "hookd-deploy",
      ]);
      if (genCode !== 0) {
        console.error(chalk.red("Failed to generate SSH key"));
        process.exit(1);
      }
      console.log(`    Created: ${keyFile}`);
    } else {
      console.log(`    Exists: ${keyFile}`);
    }

    // Get fingerprint
    let fingerprint: string;
    try {
      const out = execSync(`ssh-keygen -l -E md5 -f ${pubKeyFile}`, {
        encoding: "utf8",
      });
      fingerprint = out.trim().split(" ")[1].replace("MD5:", "");
    } catch {
      console.error(chalk.red("Failed to get SSH key fingerprint"));
      process.exit(1);
    }

    // Import key to DigitalOcean if needed
    const keyCheck = await run("doctl", [
      "compute",
      "ssh-key",
      "get",
      fingerprint,
    ]);
    if (keyCheck.code !== 0) {
      const importResult = await run("doctl", [
        "compute",
        "ssh-key",
        "import",
        "hookd-deploy-key",
        "--public-key-file",
        pubKeyFile,
      ]);
      if (importResult.code !== 0) {
        console.error(
          chalk.red(
            "Failed to import SSH key to DigitalOcean. Is doctl authenticated?",
          ),
        );
        console.error(importResult.stderr);
        process.exit(1);
      }
      console.log("    Imported SSH key to DigitalOcean");
    }

    // ── Step 2: Create Droplet ─────────────────────────────────────
    process.stdout.write(
      chalk.blue("==>") + " Creating Droplet (this may take a minute)...\n",
    );
    const userData = cloudInitScript(domain, repo);

    const dropletResult = await run("doctl", [
      "compute",
      "droplet",
      "create",
      name,
      "--image",
      "ubuntu-22-04-x64",
      "--size",
      size,
      "--region",
      region,
      "--ssh-keys",
      fingerprint,
      "--user-data",
      userData,
      "--tag-name",
      "hookd",
      "--wait",
      "--format",
      "ID",
      "--no-header",
    ]);
    if (dropletResult.code !== 0 || !dropletResult.stdout) {
      console.error(chalk.red("Failed to create Droplet"));
      console.error(dropletResult.stderr);
      process.exit(1);
    }
    const dropletId = dropletResult.stdout;
    console.log(`    Droplet: ${dropletId}`);

    // ── Step 3: Reserved IP ────────────────────────────────────────
    process.stdout.write(chalk.blue("==>") + " Assigning static IP...\n");
    const ipResult = await run("doctl", [
      "compute",
      "reserved-ip",
      "create",
      "--droplet-id",
      dropletId,
      "--region",
      region,
      "--format",
      "IP",
      "--no-header",
    ]);
    if (ipResult.code !== 0 || !ipResult.stdout) {
      console.error(chalk.red("Failed to assign reserved IP"));
      console.error(ipResult.stderr);
      process.exit(1);
    }
    const reservedIp = ipResult.stdout;
    console.log(`    Static IP: ${reservedIp}`);

    // ── Step 4: Wait for hookd ─────────────────────────────────────
    console.log();
    console.log(
      chalk.blue("==>") +
        " hookd is installing on the server (this takes 2-3 minutes)...",
    );
    console.log(
      `    Watch progress: ssh -i ${keyFile} root@${reservedIp} 'tail -f /var/log/cloud-init-output.log'`,
    );
    console.log();

    await waitForHealthIP(reservedIp, domain);

    // ── Summary ────────────────────────────────────────────────────
    console.log();
    console.log("=".repeat(72));
    console.log();
    console.log("  " + chalk.green("hookd server deployed!"));
    console.log();
    console.log(`  Droplet:     ${dropletId}`);
    console.log(`  Public IP:   ${reservedIp}`);
    console.log(`  SSH:         ssh -i ${keyFile} root@${reservedIp}`);
    console.log();
    console.log("  ┌─────────────────────────────────────────────────────┐");
    console.log("  │  NEXT STEP: Point your DNS A record                │");
    console.log("  │                                                     │");
    console.log(`  │    ${domain}  →  ${reservedIp}`);
    console.log("  │                                                     │");
    console.log("  │  Once DNS propagates, HTTPS activates automatically │");
    console.log("  └─────────────────────────────────────────────────────┘");
    console.log();
    console.log(`  After DNS is set, verify:  https://${domain}/health`);
    console.log();
    console.log("  Then on your local machine:");
    console.log(`    hookd setup -s https://${domain}`);
    console.log();
    console.log("=".repeat(72));
    console.log();
  });
