#!/bin/bash
# deploy/aws.sh — Deploy hookr to AWS EC2 in one script.
#
# Prerequisites:
#   1. AWS CLI installed and configured (aws configure)
#   2. A domain name you control
#
# Usage:
#   ./deploy/aws.sh hookr.example.com
#   ./deploy/aws.sh hookr.example.com us-east-1
#
# What this script does:
#   1. Creates a security group allowing ports 22, 80, 443
#   2. Creates an SSH key pair (saved locally)
#   3. Launches an Ubuntu EC2 instance with hookr auto-setup
#   4. Allocates a static IP (Elastic IP) and attaches it
#   5. Prints the IP — you point your DNS A record at it
#   6. Waits for hookr to come online
#
# Estimated time: ~5 minutes
# Estimated cost: ~$4-9/month (t3.micro or t3.small)

set -euo pipefail

DOMAIN="${1:?Usage: ./deploy/aws.sh <domain> [region]}"
REGION="${2:-us-east-1}"
INSTANCE_TYPE="t3.small"
KEY_NAME="hookr-deploy-key"
SG_NAME="hookr-server"

echo ""
echo "==> Deploying hookr to AWS EC2"
echo "    Domain:   ${DOMAIN}"
echo "    Region:   ${REGION}"
echo "    Instance: ${INSTANCE_TYPE}"
echo ""

# ── Step 1: Security Group ─────────────────────────────────────────
echo "==> Creating security group..."
VPC_ID=$(aws ec2 describe-vpcs \
  --region "$REGION" \
  --filters "Name=isDefault,Values=true" \
  --query "Vpcs[0].VpcId" \
  --output text)

# Check if security group already exists
SG_ID=$(aws ec2 describe-security-groups \
  --region "$REGION" \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query "SecurityGroups[0].GroupId" \
  --output text 2>/dev/null || echo "None")

if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID=$(aws ec2 create-security-group \
    --region "$REGION" \
    --group-name "$SG_NAME" \
    --description "hookr server - HTTP, HTTPS, SSH" \
    --vpc-id "$VPC_ID" \
    --query "GroupId" \
    --output text)

  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
    --ip-permissions \
      "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0,Description=SSH}]" \
      "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP}]" \
      "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}]" \
      "IpProtocol=udp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP3}]"

  echo "    Created: ${SG_ID}"
else
  echo "    Exists: ${SG_ID}"
fi

# ── Step 2: SSH Key Pair ───────────────────────────────────────────
KEY_FILE="${HOME}/.ssh/${KEY_NAME}.pem"
echo "==> Setting up SSH key..."

if ! aws ec2 describe-key-pairs --region "$REGION" --key-names "$KEY_NAME" &>/dev/null; then
  aws ec2 create-key-pair \
    --region "$REGION" \
    --key-name "$KEY_NAME" \
    --query "KeyMaterial" \
    --output text > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "    Created: ${KEY_FILE}"
else
  echo "    Exists: ${KEY_NAME}"
fi

# ── Step 3: Find Ubuntu 22.04 AMI ─────────────────────────────────
echo "==> Finding Ubuntu 22.04 AMI..."
AMI_ID=$(aws ec2 describe-images \
  --region "$REGION" \
  --owners 099720109477 \
  --filters \
    "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
    "Name=state,Values=available" \
  --query "Images | sort_by(@, &CreationDate) | [-1].ImageId" \
  --output text)
echo "    AMI: ${AMI_ID}"

# ── Step 4: Prepare user-data ──────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
USER_DATA=$(HOOKR_DOMAIN="$DOMAIN" envsubst '$HOOKR_DOMAIN' < "${SCRIPT_DIR}/cloud-init.sh" | base64 -w 0)

# ── Step 5: Launch instance ────────────────────────────────────────
echo "==> Launching EC2 instance..."
INSTANCE_ID=$(aws ec2 run-instances \
  --region "$REGION" \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data "$USER_DATA" \
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=hookr-server},{Key=hookr-domain,Value=${DOMAIN}}]" \
  --query "Instances[0].InstanceId" \
  --output text)
echo "    Instance: ${INSTANCE_ID}"

echo "==> Waiting for instance to start..."
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"

# ── Step 6: Elastic IP ─────────────────────────────────────────────
echo "==> Allocating static IP..."
ALLOC_ID=$(aws ec2 allocate-address \
  --region "$REGION" \
  --domain vpc \
  --query "AllocationId" \
  --output text)

PUBLIC_IP=$(aws ec2 describe-addresses \
  --region "$REGION" \
  --allocation-ids "$ALLOC_ID" \
  --query "Addresses[0].PublicIp" \
  --output text)

aws ec2 associate-address \
  --region "$REGION" \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "$ALLOC_ID" >/dev/null

echo "    Static IP: ${PUBLIC_IP}"

# ── Step 7: Wait for hookr ─────────────────────────────────────────
echo ""
echo "==> hookr is installing on the server (this takes 3-5 minutes)..."
echo "    You can watch progress with:"
echo "    ssh -i ${KEY_FILE} ubuntu@${PUBLIC_IP} 'tail -f /var/log/cloud-init-output.log'"
echo ""

# Poll health endpoint (via direct IP, HTTP — Caddy won't have TLS yet without DNS)
for i in $(seq 1 60); do
  if curl -sf "http://${PUBLIC_IP}:80/health" -H "Host: ${DOMAIN}" >/dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  sleep 5
done

echo ""
echo "========================================================================"
echo ""
echo "  hookr server deployed!"
echo ""
echo "  Instance:    ${INSTANCE_ID}"
echo "  Public IP:   ${PUBLIC_IP}"
echo "  SSH:         ssh -i ${KEY_FILE} ubuntu@${PUBLIC_IP}"
echo ""
echo "  ┌─────────────────────────────────────────────────────┐"
echo "  │  NEXT STEP: Point your DNS A record                │"
echo "  │                                                     │"
echo "  │    ${DOMAIN}  →  ${PUBLIC_IP}             "
echo "  │                                                     │"
echo "  │  Once DNS propagates, HTTPS activates automatically │"
echo "  └─────────────────────────────────────────────────────┘"
echo ""
echo "  After DNS is set, verify:  https://${DOMAIN}/health"
echo ""
echo "  Then on your local machine:"
echo "    hookr setup -s https://${DOMAIN}"
echo ""
echo "========================================================================"
