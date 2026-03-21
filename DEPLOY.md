# Deploying hookr

This guide has step-by-step CLI commands for deploying hookr to a cloud server. Every step is a single command — no console clicking, no GUI, no manual editing. An AI agent with cloud API credentials can follow these instructions directly.

## What you need before starting

1. **A domain name** (e.g. `hookr.example.com`) — you'll point it at the server's IP
2. **Cloud provider credentials** — one of:
   - AWS: Access key + secret key (`aws configure`)
   - DigitalOcean: API token (`doctl auth init`)

## Option A: One-command deploy scripts

The fastest path. These scripts handle everything — creating the server, installing Docker, starting hookr with HTTPS.

### AWS

```bash
# Install AWS CLI if you don't have it
# https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

# Configure credentials
aws configure
# Enter: Access Key ID, Secret Access Key, region (e.g. us-east-1), output format (json)

# Deploy hookr (creates EC2 instance + Elastic IP)
git clone https://github.com/aimxlabs/hookr.git
cd hookr
./deploy/aws.sh hookr.example.com

# The script outputs the server's IP address.
# Point your DNS A record at that IP, then HTTPS works automatically.
```

### DigitalOcean

```bash
# Install doctl if you don't have it
# https://docs.digitalocean.com/reference/doctl/how-to/install/

# Authenticate
doctl auth init
# Enter your API token

# Deploy hookr (creates Droplet + Reserved IP)
git clone https://github.com/aimxlabs/hookr.git
cd hookr
./deploy/digitalocean.sh hookr.example.com

# The script outputs the server's IP address.
# Point your DNS A record at that IP, then HTTPS works automatically.
```

---

## Option B: Step-by-step manual commands

If the deploy scripts don't work for your setup, or you want to understand each step, here are the individual commands. These are written for AWS EC2 but the pattern is the same on any provider.

### Step 1: Create the server

```bash
# Choose your region
REGION="us-east-1"
DOMAIN="hookr.example.com"

# Find the default VPC
VPC_ID=$(aws ec2 describe-vpcs \
  --region "$REGION" \
  --filters "Name=isDefault,Values=true" \
  --query "Vpcs[0].VpcId" \
  --output text)

# Create a security group that allows web traffic and SSH
SG_ID=$(aws ec2 create-security-group \
  --region "$REGION" \
  --group-name "hookr-server" \
  --description "hookr - HTTP, HTTPS, SSH" \
  --vpc-id "$VPC_ID" \
  --query "GroupId" \
  --output text)

# Open ports 22 (SSH), 80 (HTTP), 443 (HTTPS)
aws ec2 authorize-security-group-ingress \
  --region "$REGION" \
  --group-id "$SG_ID" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]"
```

### Step 2: Create an SSH key pair

```bash
# Create key pair for SSH access
aws ec2 create-key-pair \
  --region "$REGION" \
  --key-name "hookr-deploy-key" \
  --query "KeyMaterial" \
  --output text > ~/.ssh/hookr-deploy-key.pem

chmod 600 ~/.ssh/hookr-deploy-key.pem
```

### Step 3: Find the Ubuntu AMI

```bash
# Get the latest Ubuntu 22.04 AMI for your region
AMI_ID=$(aws ec2 describe-images \
  --region "$REGION" \
  --owners 099720109477 \
  --filters \
    "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
    "Name=state,Values=available" \
  --query "Images | sort_by(@, &CreationDate) | [-1].ImageId" \
  --output text)

echo "AMI: $AMI_ID"
```

### Step 4: Launch the instance

```bash
# This user-data script runs on first boot and sets up everything
USER_DATA=$(cat <<'USERDATA'
#!/bin/bash
set -euo pipefail
export HOOKR_DOMAIN="__DOMAIN__"

# Install Docker
apt-get update -y
apt-get install -y ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Clone and start hookr
git clone https://github.com/aimxlabs/hookr.git /opt/hookr
cd /opt/hookr
echo "HOOKR_DOMAIN=${HOOKR_DOMAIN}" > .env
docker compose up -d --build
USERDATA
)

# Replace the domain placeholder
USER_DATA=$(echo "$USER_DATA" | sed "s/__DOMAIN__/$DOMAIN/g")

# Launch the instance
INSTANCE_ID=$(aws ec2 run-instances \
  --region "$REGION" \
  --image-id "$AMI_ID" \
  --instance-type "t3.small" \
  --key-name "hookr-deploy-key" \
  --security-group-ids "$SG_ID" \
  --user-data "$USER_DATA" \
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=hookr-server}]" \
  --query "Instances[0].InstanceId" \
  --output text)

echo "Instance: $INSTANCE_ID"

# Wait for it to start
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
```

### Step 5: Assign a static IP

```bash
# Allocate an Elastic IP (static — won't change on reboot)
ALLOC_ID=$(aws ec2 allocate-address \
  --region "$REGION" \
  --domain vpc \
  --query "AllocationId" \
  --output text)

# Get the IP address
PUBLIC_IP=$(aws ec2 describe-addresses \
  --region "$REGION" \
  --allocation-ids "$ALLOC_ID" \
  --query "Addresses[0].PublicIp" \
  --output text)

# Attach it to the instance
aws ec2 associate-address \
  --region "$REGION" \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "$ALLOC_ID"

echo "Public IP: $PUBLIC_IP"
```

### Step 6: Set up DNS

Point your domain's DNS A record at the static IP:

```
Type: A
Name: hookr (or whatever subdomain you chose)
Value: <the PUBLIC_IP from step 5>
TTL: 300
```

**How to do this depends on your DNS provider:**
- **Cloudflare:** Dashboard → DNS → Add Record → Type A, Name `hookr`, Content `<IP>`
- **Namecheap:** Domain List → Manage → Advanced DNS → Add Record
- **Route 53:** `aws route53 change-resource-record-sets` (see below)
- **GoDaddy:** My Products → DNS → Add Record

**If using AWS Route 53:**

```bash
# Find your hosted zone ID
ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name "example.com" \
  --query "HostedZones[0].Id" \
  --output text | sed 's|/hostedzone/||')

# Create the A record
aws route53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID" \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "'"$DOMAIN"'",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "'"$PUBLIC_IP"'"}]
      }
    }]
  }'
```

### Step 7: Verify

Wait 1-2 minutes for DNS to propagate, then:

```bash
# Check if hookr is running
curl https://hookr.example.com/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Step 8: Connect from your local machine

```bash
# On your local machine (not the server)
npm install -g hookr

# Guided setup — creates a channel, saves server URL + token
hookr setup -s https://hookr.example.com

# Start receiving webhooks locally
hookr listen <channelId> --target http://localhost:8080/webhook
```

---

## Troubleshooting

### "Could not connect" when running hookr setup

The server might still be starting up. Docker image build takes 2-3 minutes on first deploy. SSH into the server and check:

```bash
ssh -i ~/.ssh/hookr-deploy-key.pem ubuntu@<PUBLIC_IP>
# Check cloud-init progress
tail -f /var/log/cloud-init-output.log
# Check Docker containers
cd /opt/hookr && docker compose ps
# Check hookr logs
docker compose logs hookr
```

### HTTPS not working

Caddy needs DNS to be pointing at the server before it can get a TLS certificate. Verify:

```bash
# Check if DNS is pointing to the right IP
dig hookr.example.com +short
# Should show your server's IP

# Check Caddy logs for certificate errors
ssh -i ~/.ssh/hookr-deploy-key.pem ubuntu@<PUBLIC_IP>
cd /opt/hookr && docker compose logs caddy
```

### "Permission denied" on SSH

Make sure the key file has correct permissions:

```bash
chmod 600 ~/.ssh/hookr-deploy-key.pem
ssh -i ~/.ssh/hookr-deploy-key.pem ubuntu@<PUBLIC_IP>  # AWS uses 'ubuntu' user
```

### Updating hookr

```bash
ssh -i ~/.ssh/hookr-deploy-key.pem ubuntu@<PUBLIC_IP>
cd /opt/hookr
git pull
docker compose up -d --build
```

---

## Tearing down

### AWS

```bash
# Find and terminate the instance
INSTANCE_ID=$(aws ec2 describe-instances \
  --region "$REGION" \
  --filters "Name=tag:Name,Values=hookr-server" "Name=instance-state-name,Values=running" \
  --query "Instances[0].InstanceId" \
  --output text)

aws ec2 terminate-instances --region "$REGION" --instance-ids "$INSTANCE_ID"

# Release the Elastic IP
ALLOC_ID=$(aws ec2 describe-addresses \
  --region "$REGION" \
  --filters "Name=tag:Name,Values=hookr-server" \
  --query "Addresses[0].AllocationId" \
  --output text)

aws ec2 release-address --region "$REGION" --allocation-id "$ALLOC_ID"

# Optionally delete the security group and key pair
aws ec2 delete-security-group --region "$REGION" --group-name "hookr-server"
aws ec2 delete-key-pair --region "$REGION" --key-name "hookr-deploy-key"
```

### DigitalOcean

```bash
doctl compute droplet delete hookr-server --force
doctl compute reserved-ip list --format IP --no-header | xargs -I{} doctl compute reserved-ip delete {} --force
```
