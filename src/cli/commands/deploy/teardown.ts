import { Command } from "commander";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { createInterface } from "node:readline";
import { run } from "./helpers.js";

/** Prompt for text input on stdin. */
function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function teardownAws(region: string) {
  console.log(chalk.blue("==>") + " Finding hookr EC2 instance...");
  const instResult = await run("aws", [
    "ec2",
    "describe-instances",
    "--region",
    region,
    "--filters",
    "Name=tag:Name,Values=hookr-server",
    "Name=instance-state-name,Values=running,stopped",
    "--query",
    "Reservations[].Instances[0].InstanceId",
    "--output",
    "text",
  ]);

  const instanceId = instResult.stdout;
  if (!instanceId || instanceId === "None") {
    console.log(chalk.yellow("    No hookr instance found in " + region));
  } else {
    console.log(`    Terminating instance: ${instanceId}`);
    await run("aws", [
      "ec2",
      "terminate-instances",
      "--region",
      region,
      "--instance-ids",
      instanceId,
    ]);
    console.log("    Waiting for termination...");
    await run("aws", [
      "ec2",
      "wait",
      "instance-terminated",
      "--region",
      region,
      "--instance-ids",
      instanceId,
    ]);
    console.log(chalk.green("    Instance terminated"));
  }

  console.log(chalk.blue("==>") + " Releasing Elastic IPs...");
  let allocResult = await run("aws", [
    "ec2",
    "describe-addresses",
    "--region",
    region,
    "--query",
    "Addresses[?Tags[?Key=='hookr-domain']].AllocationId",
    "--output",
    "text",
  ]);

  let allocIds = allocResult.stdout
    .split(/\s+/)
    .filter((id) => id && id !== "None");

  if (allocIds.length === 0) {
    allocResult = await run("aws", [
      "ec2",
      "describe-addresses",
      "--region",
      region,
      "--query",
      "Addresses[?!AssociationId].AllocationId",
      "--output",
      "text",
    ]);
    allocIds = allocResult.stdout
      .split(/\s+/)
      .filter((id) => id && id !== "None");
  }

  for (const allocId of allocIds) {
    await run("aws", [
      "ec2",
      "release-address",
      "--region",
      region,
      "--allocation-id",
      allocId,
    ]);
    console.log(`    Released Elastic IP: ${allocId}`);
  }

  console.log(chalk.blue("==>") + " Cleaning up security group...");
  await run("aws", [
    "ec2",
    "delete-security-group",
    "--region",
    region,
    "--group-name",
    "hookr-server",
  ]);

  console.log(chalk.blue("==>") + " Cleaning up key pair...");
  await run("aws", [
    "ec2",
    "delete-key-pair",
    "--region",
    region,
    "--key-name",
    "hookr-deploy-key",
  ]);
  try {
    unlinkSync(join(homedir(), ".ssh", "hookr-deploy-key.pem"));
  } catch {
    // key file may not exist
  }

  console.log();
  console.log(chalk.green("==> AWS teardown complete. All hookr resources removed."));
}

async function teardownDigitalocean() {
  console.log(chalk.blue("==>") + " Finding hookr Droplet...");
  const dropletResult = await run("doctl", [
    "compute",
    "droplet",
    "list",
    "--tag-name",
    "hookr",
    "--format",
    "ID",
    "--no-header",
  ]);

  const dropletId = dropletResult.stdout;
  if (!dropletId) {
    console.log(chalk.yellow("    No hookr droplet found"));
  } else {
    console.log(`    Deleting Droplet: ${dropletId}`);
    await run("doctl", [
      "compute",
      "droplet",
      "delete",
      dropletId,
      "--force",
    ]);
    console.log(chalk.green("    Droplet deleted"));
  }

  console.log(chalk.blue("==>") + " Releasing reserved IPs...");
  const ipResult = await run("doctl", [
    "compute",
    "reserved-ip",
    "list",
    "--format",
    "IP,DropletID",
    "--no-header",
  ]);

  for (const line of ipResult.stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const ip = parts[0];
    const did = parts[1];
    if (ip && !did) {
      await run("doctl", [
        "compute",
        "reserved-ip",
        "delete",
        ip,
        "--force",
      ]);
      console.log(`    Released IP: ${ip}`);
    }
  }

  try {
    unlinkSync(join(homedir(), ".ssh", "hookr-deploy-key"));
    unlinkSync(join(homedir(), ".ssh", "hookr-deploy-key.pub"));
  } catch {
    // key files may not exist
  }

  console.log();
  console.log(
    chalk.green("==> DigitalOcean teardown complete. All hookr resources removed."),
  );
}

export const teardownSubcommand = new Command("teardown")
  .description("Destroy the hookr server and all cloud resources")
  .argument("<provider>", "Cloud provider: aws or digitalocean")
  .argument("[region]", "AWS region (only for AWS)", "us-east-1")
  .action(async (provider: string, region: string) => {
    console.log();
    console.log(
      chalk.red.bold("  ╔══════════════════════════════════════════════════════╗"),
    );
    console.log(
      chalk.red.bold("  ║  THIS WILL PERMANENTLY DESTROY YOUR HOOKR SERVER    ║"),
    );
    console.log(
      chalk.red.bold("  ║  All data, channels, and tokens will be lost.       ║"),
    );
    console.log(
      chalk.red.bold("  ╚══════════════════════════════════════════════════════╝"),
    );
    console.log();

    const confirm = await prompt("Type 'destroy' to confirm: ");
    if (confirm !== "destroy") {
      console.log("Teardown cancelled.");
      return;
    }
    console.log();

    switch (provider) {
      case "aws":
        await teardownAws(region);
        break;
      case "digitalocean":
      case "do":
        await teardownDigitalocean();
        break;
      default:
        console.error(chalk.red(`Unknown provider: ${provider}`));
        console.error("Supported: aws, digitalocean");
        process.exit(1);
    }
  });
