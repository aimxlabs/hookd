import { Command } from "commander";
import { existsSync, unlinkSync } from "node:fs";
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

interface AwsResources {
  instanceId: string | null;
  elasticIpAllocIds: string[];
  securityGroup: boolean;
  keyPair: boolean;
  localKeyFile: string | null;
}

interface DigitaloceanResources {
  dropletId: string | null;
  reservedIps: string[];
  localKeyFiles: string[];
}

async function discoverAwsResources(region: string): Promise<AwsResources> {
  console.log(chalk.blue("==>") + " Discovering hookd resources...");

  const instResult = await run("aws", [
    "ec2",
    "describe-instances",
    "--region",
    region,
    "--filters",
    "Name=tag:Name,Values=hookd-server",
    "Name=instance-state-name,Values=running,stopped",
    "--query",
    "Reservations[].Instances[0].InstanceId",
    "--output",
    "text",
  ]);
  const instanceId =
    instResult.stdout && instResult.stdout !== "None"
      ? instResult.stdout
      : null;

  let allocResult = await run("aws", [
    "ec2",
    "describe-addresses",
    "--region",
    region,
    "--query",
    "Addresses[?Tags[?Key=='hookd-domain']].AllocationId",
    "--output",
    "text",
  ]);
  let elasticIpAllocIds = allocResult.stdout
    .split(/\s+/)
    .filter((id) => id && id !== "None");

  if (elasticIpAllocIds.length === 0) {
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
    elasticIpAllocIds = allocResult.stdout
      .split(/\s+/)
      .filter((id) => id && id !== "None");
  }

  const sgResult = await run("aws", [
    "ec2",
    "describe-security-groups",
    "--region",
    region,
    "--group-names",
    "hookd-server",
    "--query",
    "SecurityGroups[0].GroupId",
    "--output",
    "text",
  ]);
  const securityGroup = !!(sgResult.stdout && sgResult.stdout !== "None");

  const kpResult = await run("aws", [
    "ec2",
    "describe-key-pairs",
    "--region",
    region,
    "--key-names",
    "hookd-deploy-key",
    "--query",
    "KeyPairs[0].KeyPairId",
    "--output",
    "text",
  ]);
  const keyPair = !!(kpResult.stdout && kpResult.stdout !== "None");

  const localKeyPath = join(homedir(), ".ssh", "hookd-deploy-key.pem");
  const localKeyFile = existsSync(localKeyPath) ? localKeyPath : null;

  return { instanceId, elasticIpAllocIds, securityGroup, keyPair, localKeyFile };
}

async function discoverDigitaloceanResources(): Promise<DigitaloceanResources> {
  console.log(chalk.blue("==>") + " Discovering hookd resources...");

  const dropletResult = await run("doctl", [
    "compute",
    "droplet",
    "list",
    "--tag-name",
    "hookd",
    "--format",
    "ID",
    "--no-header",
  ]);
  const dropletId = dropletResult.stdout || null;

  const ipResult = await run("doctl", [
    "compute",
    "reserved-ip",
    "list",
    "--format",
    "IP,DropletID",
    "--no-header",
  ]);
  const reservedIps: string[] = [];
  for (const line of ipResult.stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const ip = parts[0];
    const did = parts[1];
    if (ip && !did) {
      reservedIps.push(ip);
    }
  }

  const localKeyFiles: string[] = [];
  for (const name of ["hookd-deploy-key", "hookd-deploy-key.pub"]) {
    const p = join(homedir(), ".ssh", name);
    if (existsSync(p)) localKeyFiles.push(p);
  }

  return { dropletId, reservedIps, localKeyFiles };
}

function displayAwsResources(resources: AwsResources, region: string) {
  console.log();
  console.log(chalk.bold("  The following resources will be destroyed:"));
  if (resources.instanceId) {
    console.log(`    ${chalk.red("•")} EC2 instance: ${resources.instanceId} (${region})`);
  }
  for (const allocId of resources.elasticIpAllocIds) {
    console.log(`    ${chalk.red("•")} Elastic IP: ${allocId}`);
  }
  if (resources.securityGroup) {
    console.log(`    ${chalk.red("•")} Security group: hookd-server`);
  }
  if (resources.keyPair) {
    console.log(`    ${chalk.red("•")} Key pair: hookd-deploy-key`);
  }
  if (resources.localKeyFile) {
    console.log(`    ${chalk.red("•")} Local SSH key: ${resources.localKeyFile}`);
  }
  console.log();
}

function displayDigitaloceanResources(resources: DigitaloceanResources) {
  console.log();
  console.log(chalk.bold("  The following resources will be destroyed:"));
  if (resources.dropletId) {
    console.log(`    ${chalk.red("•")} Droplet: ${resources.dropletId}`);
  }
  for (const ip of resources.reservedIps) {
    console.log(`    ${chalk.red("•")} Reserved IP: ${ip}`);
  }
  for (const f of resources.localKeyFiles) {
    console.log(`    ${chalk.red("•")} Local SSH key: ${f}`);
  }
  console.log();
}

function hasResources(resources: AwsResources | DigitaloceanResources): boolean {
  if ("instanceId" in resources) {
    const r = resources as AwsResources;
    return !!(r.instanceId || r.elasticIpAllocIds.length || r.securityGroup || r.keyPair || r.localKeyFile);
  }
  const r = resources as DigitaloceanResources;
  return !!(r.dropletId || r.reservedIps.length || r.localKeyFiles.length);
}

async function teardownAws(resources: AwsResources, region: string) {
  if (resources.instanceId) {
    console.log(chalk.blue("==>") + ` Terminating instance: ${resources.instanceId}`);
    await run("aws", [
      "ec2",
      "terminate-instances",
      "--region",
      region,
      "--instance-ids",
      resources.instanceId,
    ]);
    console.log("    Waiting for termination...");
    await run("aws", [
      "ec2",
      "wait",
      "instance-terminated",
      "--region",
      region,
      "--instance-ids",
      resources.instanceId,
    ]);
    console.log(chalk.green("    Instance terminated"));
  }

  for (const allocId of resources.elasticIpAllocIds) {
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

  if (resources.securityGroup) {
    console.log(chalk.blue("==>") + " Cleaning up security group...");
    await run("aws", [
      "ec2",
      "delete-security-group",
      "--region",
      region,
      "--group-name",
      "hookd-server",
    ]);
  }

  if (resources.keyPair) {
    console.log(chalk.blue("==>") + " Cleaning up key pair...");
    await run("aws", [
      "ec2",
      "delete-key-pair",
      "--region",
      region,
      "--key-name",
      "hookd-deploy-key",
    ]);
  }

  if (resources.localKeyFile) {
    try {
      unlinkSync(resources.localKeyFile);
    } catch {
      // key file may not exist
    }
  }

  console.log();
  console.log(
    chalk.green("==> AWS teardown complete. All hookd resources removed."),
  );
}

async function teardownDigitalocean(resources: DigitaloceanResources) {
  if (resources.dropletId) {
    console.log(chalk.blue("==>") + ` Deleting Droplet: ${resources.dropletId}`);
    await run("doctl", ["compute", "droplet", "delete", resources.dropletId, "--force"]);
    console.log(chalk.green("    Droplet deleted"));
  }

  for (const ip of resources.reservedIps) {
    await run("doctl", ["compute", "reserved-ip", "delete", ip, "--force"]);
    console.log(`    Released IP: ${ip}`);
  }

  for (const f of resources.localKeyFiles) {
    try {
      unlinkSync(f);
    } catch {
      // key file may not exist
    }
  }

  console.log();
  console.log(
    chalk.green(
      "==> DigitalOcean teardown complete. All hookd resources removed.",
    ),
  );
}

export const teardownSubcommand = new Command("teardown")
  .description("Destroy the hookd server and all cloud resources")
  .argument("<provider>", "Cloud provider: aws or digitalocean")
  .argument("[region]", "AWS region (only for AWS)", "us-east-1")
  .action(async (provider: string, region: string) => {
    // Discover resources first
    let resources: AwsResources | DigitaloceanResources;
    switch (provider) {
      case "aws":
        resources = await discoverAwsResources(region);
        break;
      case "digitalocean":
      case "do":
        resources = await discoverDigitaloceanResources();
        break;
      default:
        console.error(chalk.red(`Unknown provider: ${provider}`));
        console.error("Supported: aws, digitalocean");
        process.exit(1);
    }

    if (!hasResources(resources)) {
      console.log(chalk.yellow("\n  No hookd resources found. Nothing to tear down.\n"));
      return;
    }

    // Display what will be destroyed
    if ("instanceId" in resources) {
      displayAwsResources(resources as AwsResources, region);
    } else {
      displayDigitaloceanResources(resources as DigitaloceanResources);
    }

    // Confirmation
    console.log(
      chalk.red.bold(
        "  ╔══════════════════════════════════════════════════════╗",
      ),
    );
    console.log(
      chalk.red.bold(
        "  ║  THIS WILL PERMANENTLY DESTROY YOUR HOOKD SERVER    ║",
      ),
    );
    console.log(
      chalk.red.bold(
        "  ║  All data, channels, and tokens will be lost.       ║",
      ),
    );
    console.log(
      chalk.red.bold(
        "  ╚══════════════════════════════════════════════════════╝",
      ),
    );
    console.log();

    const confirm = await prompt("Type 'destroy' to confirm: ");
    if (confirm !== "destroy") {
      console.log("Teardown cancelled.");
      return;
    }
    console.log();

    // Execute teardown with already-discovered resources
    if ("instanceId" in resources) {
      await teardownAws(resources as AwsResources, region);
    } else {
      await teardownDigitalocean(resources as DigitaloceanResources);
    }
  });
