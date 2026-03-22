# Deploying hookr

This guide has step-by-step CLI commands for deploying hookr to a cloud server. Every step is a single command — no console clicking, no GUI, no manual editing. An AI agent with cloud API credentials can follow these instructions directly.

## What you need before starting

1. **A domain name** (e.g. `hookr.example.com`) — you'll point it at the server's IP
2. **Cloud provider credentials** — one of:
   - AWS: Access key + secret key (`aws configure`)
   - DigitalOcean: API token (`doctl auth init`)

## Option A: One-command deploy

The fastest path. The `hookr deploy` command handles everything — creating the server, installing Docker, starting hookr with HTTPS.

### AWS

```bash
# Prerequisites: AWS CLI installed and configured
# https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
aws configure

# Deploy hookr (creates EC2 instance + Elastic IP)
hookr deploy aws hookr.example.com

# Optional: specify region and instance type
hookr deploy aws hookr.example.com us-west-2 --instance-type t3.micro

# If your account has no default VPC, specify VPC and subnet explicitly
hookr deploy aws hookr.example.com us-east-1 --vpc-id vpc-xxx --subnet-id subnet-yyy
```

### DigitalOcean

```bash
# Prerequisites: doctl CLI installed and authenticated
# https://docs.digitalocean.com/reference/doctl/how-to/install/
doctl auth init

# Deploy hookr (creates Droplet + Reserved IP)
hookr deploy digitalocean hookr.example.com

# Optional: specify region and size
hookr deploy digitalocean hookr.example.com sfo1 --size s-1vcpu-2gb
```

### After deploying

The deploy command outputs the server's IP address. Point your DNS A record at that IP, then HTTPS activates automatically.

The deploy also auto-generates an admin token (needed for channel management). Retrieve it from the server:

```bash
ssh -i ~/.ssh/hookr-deploy-key.pem ubuntu@<PUBLIC_IP> 'sudo cat /opt/hookr/.admin-token'
```

Then set it locally before running `hookr setup`:

```bash
export HOOKR_ADMIN_TOKEN=<token-from-above>
hookr setup -s https://hookr.example.com
```

---

## Option B: Step-by-step manual commands

If `hookr deploy` doesn't work for your setup, or you want to understand each step, here are the individual commands. These are written for AWS EC2 but the pattern is the same on any provider.

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
ADMIN_TOKEN=$(openssl rand -hex 32)
cat > .env <<EOF2
HOOKR_DOMAIN=${HOOKR_DOMAIN}
HOOKR_ADMIN_TOKEN=${ADMIN_TOKEN}
EOF2
docker compose up -d --build
echo "Admin token: ${ADMIN_TOKEN}"
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
  --associate-public-ip-address \
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

# Retrieve the admin token from the server
ssh -i ~/.ssh/hookr-deploy-key.pem ubuntu@<PUBLIC_IP> 'sudo cat /opt/hookr/.admin-token'

# Set it locally
export HOOKR_ADMIN_TOKEN=<admin-token-from-above>

# Guided setup — creates a channel, saves server URL + token
hookr setup -s https://hookr.example.com

# Start receiving webhooks locally
hookr listen <channelId> --target http://localhost:8080/webhook
```

> **Note:** The admin token is needed for creating, listing, and deleting channels. Once you have a channel, the channel's auth token (saved automatically by `hookr setup`) is all you need for `listen`, `poll`, and `inspect`.

---

## Managing your hookr server

After deployment, use `hookr manage` to manage your server. If you already ran `hookr setup`, the host is detected automatically from your saved server URL. Otherwise pass `--host <ip>`.

### Quick reference

```bash
# If you ran hookr setup, the host is auto-detected from your server URL
hookr manage status                          # Container health, disk usage
hookr manage logs                            # Tail logs (Ctrl+C to stop)
hookr manage update                          # Pull latest code, rebuild, restart

# Or specify the host explicitly
hookr manage status  --host 1.2.3.4          # Container health, disk usage
hookr manage start   --host 1.2.3.4          # Start containers
hookr manage stop    --host 1.2.3.4          # Stop containers
hookr manage restart --host 1.2.3.4          # Restart containers
hookr manage update  --host 1.2.3.4          # Pull latest code, rebuild, restart
hookr manage logs    --host 1.2.3.4          # Tail logs (Ctrl+C to stop)
hookr manage backup  --host 1.2.3.4          # Download database backup
hookr manage restore --host 1.2.3.4 backup.db  # Restore from backup
hookr manage ssh     --host 1.2.3.4          # Open SSH session
hookr manage domain  --host 1.2.3.4 new.example.com  # Change domain
hookr manage env     --host 1.2.3.4          # Show current .env
hookr manage cleanup --host 1.2.3.4          # Free disk space (prune Docker)

# Teardown (requires aws/doctl CLI)
hookr deploy teardown aws                    # Destroy all AWS resources
hookr deploy teardown digitalocean           # Destroy all DO resources
```

### Common operations

**Check if hookr is running:**
```bash
hookr manage status --host 1.2.3.4
```

**Update to latest version:**
```bash
hookr manage update --host 1.2.3.4
```

**View logs for debugging:**
```bash
# All logs, follow mode
hookr manage logs --host 1.2.3.4

# Last 50 lines, no follow
hookr manage logs --host 1.2.3.4 --lines 50 --no-follow

# Just hookr logs (not Caddy)
hookr manage logs --host 1.2.3.4 --service hookr
```

**Backup before making changes:**
```bash
hookr manage backup --host 1.2.3.4 --output hookr-2024-01-15.db
```

**Restore from backup:**
```bash
hookr manage restore --host 1.2.3.4 hookr-2024-01-15.db
```

**Change domain:**
```bash
hookr manage domain --host 1.2.3.4 new-hookr.example.com
```

**Tear everything down:**
```bash
hookr deploy teardown aws
hookr deploy teardown digitalocean
```

### Saving connection details

Save your SSH connection info so you don't need `--host` every time:

```bash
# Interactive — prompts for host, SSH key, user, remote directory
hookr manage init

# Or use environment variables
export HOOKR_HOST="1.2.3.4"
export HOOKR_SSH_KEY="$HOME/.ssh/hookr-deploy-key.pem"
export HOOKR_SSH_USER="ubuntu"

# Now just:
hookr manage status
hookr manage update
hookr manage logs
```

> **Tip:** If you already ran `hookr setup` or `hookr login` with a remote server URL, `hookr manage` auto-detects the host from your saved config — no extra setup needed.

---

## Troubleshooting

### "Could not connect" when running hookr setup

The server might still be starting up. Docker image build takes 2-3 minutes on first deploy:

```bash
hookr manage status --host <PUBLIC_IP>
hookr manage logs --host <PUBLIC_IP> --no-follow
```

Or SSH in and check cloud-init progress:

```bash
hookr manage ssh --host <PUBLIC_IP>
tail -f /var/log/cloud-init-output.log
```

### HTTPS not working

Caddy needs DNS to be pointing at the server before it can get a TLS certificate. Verify:

```bash
# Check if DNS is pointing to the right IP
dig hookr.example.com +short
# Should show your server's IP

# Check Caddy logs for certificate errors
hookr manage logs --host <PUBLIC_IP> --service caddy --no-follow
```

### "Permission denied" on SSH

Make sure the key file has correct permissions:

```bash
chmod 600 ~/.ssh/hookr-deploy-key.pem
```

### Server running out of disk space

```bash
hookr manage cleanup --host <PUBLIC_IP>
```
