import { Command } from "commander";
import { writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import ora from "ora";
import {
  cloudInitScript,
  run,
  runInherit,
  waitForHealthIP,
} from "./helpers.js";

export const awsSubcommand = new Command("aws")
  .description("Deploy hookd to AWS EC2 (~$4-9/month, ~5 min)")
  .argument("<domain>", "Domain name (e.g. hookd.example.com)")
  .argument("[region]", "AWS region", "us-east-1")
  .option("--instance-type <type>", "EC2 instance type", "t3.small")
  .option("--key-name <name>", "SSH key pair name", "hookd-deploy-key")
  .option("--sg-name <name>", "Security group name", "hookd-server")
  .option(
    "--repo <url>",
    "Git repository URL for hookd source",
    "https://github.com/aimxlabs/hookd.git",
  )
  .option("--vpc-id <id>", "VPC ID (defaults to the default VPC)")
  .option("--subnet-id <id>", "Subnet ID (required if using a non-default VPC)")
  .action(async (domain: string, region: string, opts) => {
    const {
      instanceType,
      keyName,
      sgName,
      repo,
      vpcId: optVpcId,
      subnetId,
    } = opts;

    console.log();
    console.log(chalk.bold("==>") + " Deploying hookd to AWS EC2");
    console.log(`    Domain:   ${domain}`);
    console.log(`    Region:   ${region}`);
    console.log(`    Instance: ${instanceType}`);
    console.log();

    // ── Step 1: Security Group ─────────────────────────────────────
    process.stdout.write(chalk.blue("==>") + " Setting up security group...\n");

    let vpcId: string;
    if (optVpcId) {
      vpcId = optVpcId;
    } else {
      const vpcResult = await run("aws", [
        "ec2",
        "describe-vpcs",
        "--region",
        region,
        "--filters",
        "Name=isDefault,Values=true",
        "--query",
        "Vpcs[0].VpcId",
        "--output",
        "text",
      ]);
      if (
        vpcResult.code !== 0 ||
        !vpcResult.stdout ||
        vpcResult.stdout === "None"
      ) {
        console.error(
          chalk.red(
            "No default VPC found. Use --vpc-id and --subnet-id to specify a VPC.",
          ),
        );
        process.exit(1);
      }
      vpcId = vpcResult.stdout;
    }

    const sgLookup = await run("aws", [
      "ec2",
      "describe-security-groups",
      "--region",
      region,
      "--filters",
      `Name=group-name,Values=${sgName}`,
      `Name=vpc-id,Values=${vpcId}`,
      "--query",
      "SecurityGroups[0].GroupId",
      "--output",
      "text",
    ]);

    let sgId = sgLookup.stdout;
    if (!sgId || sgId === "None") {
      const sgCreate = await run("aws", [
        "ec2",
        "create-security-group",
        "--region",
        region,
        "--group-name",
        sgName,
        "--description",
        "hookd server - HTTP, HTTPS, SSH",
        "--vpc-id",
        vpcId,
        "--query",
        "GroupId",
        "--output",
        "text",
      ]);
      if (sgCreate.code !== 0) {
        console.error(chalk.red("Failed to create security group"));
        process.exit(1);
      }
      sgId = sgCreate.stdout;

      await run("aws", [
        "ec2",
        "authorize-security-group-ingress",
        "--region",
        region,
        "--group-id",
        sgId,
        "--ip-permissions",
        "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0,Description=SSH}]",
        "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP}]",
        "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}]",
        "IpProtocol=udp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP3}]",
      ]);
      console.log(`    Created: ${sgId}`);
    } else {
      console.log(`    Exists: ${sgId}`);
    }

    // ── Step 2: SSH Key Pair ───────────────────────────────────────
    process.stdout.write(chalk.blue("==>") + " Setting up SSH key...\n");
    const keyFile = join(homedir(), ".ssh", `${keyName}.pem`);

    const keyCheck = await run("aws", [
      "ec2",
      "describe-key-pairs",
      "--region",
      region,
      "--key-names",
      keyName,
    ]);

    if (keyCheck.code !== 0) {
      const keyCreate = await run("aws", [
        "ec2",
        "create-key-pair",
        "--region",
        region,
        "--key-name",
        keyName,
        "--query",
        "KeyMaterial",
        "--output",
        "text",
      ]);
      if (keyCreate.code !== 0) {
        console.error(chalk.red("Failed to create SSH key pair"));
        process.exit(1);
      }
      writeFileSync(keyFile, keyCreate.stdout, { mode: 0o600 });
      console.log(`    Created: ${keyFile}`);
    } else {
      console.log(`    Exists: ${keyName}`);
    }

    // ── Step 3: Find Ubuntu 22.04 AMI ─────────────────────────────
    process.stdout.write(chalk.blue("==>") + " Finding Ubuntu 22.04 AMI...\n");
    const amiResult = await run("aws", [
      "ec2",
      "describe-images",
      "--region",
      region,
      "--owners",
      "099720109477",
      "--filters",
      "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*",
      "Name=state,Values=available",
      "--query",
      "Images | sort_by(@, &CreationDate) | [-1].ImageId",
      "--output",
      "text",
    ]);
    if (amiResult.code !== 0 || !amiResult.stdout) {
      console.error(chalk.red("Failed to find Ubuntu AMI"));
      process.exit(1);
    }
    const amiId = amiResult.stdout;
    console.log(`    AMI: ${amiId}`);

    // ── Step 4: Launch Instance ────────────────────────────────────
    process.stdout.write(chalk.blue("==>") + " Launching EC2 instance...\n");
    const userData = Buffer.from(cloudInitScript(domain, repo)).toString(
      "base64",
    );

    const launchArgs = [
      "ec2",
      "run-instances",
      "--region",
      region,
      "--image-id",
      amiId,
      "--instance-type",
      instanceType,
      "--key-name",
      keyName,
      "--security-group-ids",
      sgId,
      "--associate-public-ip-address",
      "--user-data",
      userData,
      "--block-device-mappings",
      "DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}",
      "--tag-specifications",
      `ResourceType=instance,Tags=[{Key=Name,Value=hookd-server},{Key=hookd-domain,Value=${domain}}]`,
      "--query",
      "Instances[0].InstanceId",
      "--output",
      "text",
    ];
    if (subnetId) {
      launchArgs.push("--subnet-id", subnetId);
    }
    const launchResult = await run("aws", launchArgs);
    if (launchResult.code !== 0 || !launchResult.stdout) {
      console.error(chalk.red("Failed to launch EC2 instance"));
      console.error(launchResult.stderr);
      process.exit(1);
    }
    const instanceId = launchResult.stdout;
    console.log(`    Instance: ${instanceId}`);

    const waitSpinner = ora("Waiting for instance to start...").start();
    const waitCode = await runInherit("aws", [
      "ec2",
      "wait",
      "instance-running",
      "--region",
      region,
      "--instance-ids",
      instanceId,
    ]);
    if (waitCode !== 0) {
      waitSpinner.fail("Instance failed to start");
      process.exit(1);
    }
    waitSpinner.succeed("Instance is running");

    // ── Step 5: Elastic IP ─────────────────────────────────────────
    process.stdout.write(chalk.blue("==>") + " Allocating static IP...\n");
    const allocResult = await run("aws", [
      "ec2",
      "allocate-address",
      "--region",
      region,
      "--domain",
      "vpc",
      "--query",
      "AllocationId",
      "--output",
      "text",
    ]);
    if (allocResult.code !== 0 || !allocResult.stdout) {
      console.error(chalk.red("Failed to allocate Elastic IP"));
      process.exit(1);
    }
    const allocId = allocResult.stdout;

    const ipResult = await run("aws", [
      "ec2",
      "describe-addresses",
      "--region",
      region,
      "--allocation-ids",
      allocId,
      "--query",
      "Addresses[0].PublicIp",
      "--output",
      "text",
    ]);
    const publicIp = ipResult.stdout;

    await run("aws", [
      "ec2",
      "associate-address",
      "--region",
      region,
      "--instance-id",
      instanceId,
      "--allocation-id",
      allocId,
    ]);
    console.log(`    Static IP: ${publicIp}`);

    // ── Step 6: Wait for hookd ─────────────────────────────────────
    console.log();
    console.log(
      chalk.blue("==>") +
        " hookd is installing on the server (this takes 3-5 minutes)...",
    );
    console.log(
      `    Watch progress: ssh -i ${keyFile} ubuntu@${publicIp} 'tail -f /var/log/cloud-init-output.log'`,
    );
    console.log();

    await waitForHealthIP(publicIp, domain);

    // ── Summary ────────────────────────────────────────────────────
    console.log();
    console.log("=".repeat(72));
    console.log();
    console.log("  " + chalk.green("hookd server deployed!"));
    console.log();
    console.log(`  Instance:    ${instanceId}`);
    console.log(`  Public IP:   ${publicIp}`);
    console.log(`  SSH:         ssh -i ${keyFile} ubuntu@${publicIp}`);
    console.log();
    console.log("  ┌─────────────────────────────────────────────────────┐");
    console.log("  │  NEXT STEP: Point your DNS A record                │");
    console.log("  │                                                     │");
    console.log(`  │    ${domain}  →  ${publicIp}`);
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
