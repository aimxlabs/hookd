#!/bin/bash
# deploy/digitalocean.sh — Deploy hookr to a DigitalOcean Droplet in one script.
#
# Prerequisites:
#   1. doctl CLI installed and authenticated (doctl auth init)
#      Or: export DIGITALOCEAN_ACCESS_TOKEN=your-api-token
#   2. A domain name you control
#
# Usage:
#   ./deploy/digitalocean.sh hookr.example.com
#   ./deploy/digitalocean.sh hookr.example.com nyc1
#
# What this script does:
#   1. Creates a Droplet with Docker pre-installed
#   2. Runs cloud-init to set up hookr + Caddy
#   3. Assigns a reserved IP
#   4. Prints the IP — you point your DNS A record at it
#
# Estimated time: ~3 minutes
# Estimated cost: $6/month (s-1vcpu-1gb)

echo "NOTE: This script is superseded by: hookr deploy digitalocean <domain> [region]"
echo "      The CLI version is the recommended way to deploy."
echo ""

set -euo pipefail

DOMAIN="${1:?Usage: ./deploy/digitalocean.sh <domain> [region]}"
REGION="${2:-nyc1}"
SIZE="s-1vcpu-1gb"
DROPLET_NAME="hookr-server"

echo ""
echo "==> Deploying hookr to DigitalOcean"
echo "    Domain: ${DOMAIN}"
echo "    Region: ${REGION}"
echo "    Size:   ${SIZE}"
echo ""

# ── Step 1: Create SSH key if needed ───────────────────────────────
KEY_FILE="${HOME}/.ssh/hookr-deploy-key"
echo "==> Setting up SSH key..."

if [ ! -f "$KEY_FILE" ]; then
  ssh-keygen -t ed25519 -f "$KEY_FILE" -N "" -C "hookr-deploy"
  echo "    Created: ${KEY_FILE}"
fi

# Import key to DigitalOcean if not already there
FINGERPRINT=$(ssh-keygen -l -E md5 -f "${KEY_FILE}.pub" | awk '{print $2}' | sed 's/MD5://')

if ! doctl compute ssh-key get "$FINGERPRINT" &>/dev/null; then
  doctl compute ssh-key import hookr-deploy-key --public-key-file "${KEY_FILE}.pub"
  echo "    Imported SSH key to DigitalOcean"
fi

# ── Step 2: Prepare user-data ──────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
USER_DATA=$(HOOKR_DOMAIN="$DOMAIN" envsubst '$HOOKR_DOMAIN' < "${SCRIPT_DIR}/cloud-init.sh")

# ── Step 3: Create Droplet ─────────────────────────────────────────
echo "==> Creating Droplet..."
DROPLET_ID=$(doctl compute droplet create "$DROPLET_NAME" \
  --image ubuntu-22-04-x64 \
  --size "$SIZE" \
  --region "$REGION" \
  --ssh-keys "$FINGERPRINT" \
  --user-data "$USER_DATA" \
  --tag-name hookr \
  --wait \
  --format ID \
  --no-header)
echo "    Droplet: ${DROPLET_ID}"

# ── Step 4: Reserved IP ───────────────────────────────────────────
echo "==> Assigning static IP..."
RESERVED_IP=$(doctl compute reserved-ip create \
  --droplet-id "$DROPLET_ID" \
  --region "$REGION" \
  --format IP \
  --no-header)
echo "    Static IP: ${RESERVED_IP}"

# ── Step 5: Wait for hookr ─────────────────────────────────────────
echo ""
echo "==> hookr is installing on the server (this takes 2-3 minutes)..."
echo "    You can watch progress with:"
echo "    ssh -i ${KEY_FILE} root@${RESERVED_IP} 'tail -f /var/log/cloud-init-output.log'"
echo ""

for i in $(seq 1 60); do
  if curl -sf "http://${RESERVED_IP}:80/health" -H "Host: ${DOMAIN}" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

echo ""
echo "========================================================================"
echo ""
echo "  hookr server deployed!"
echo ""
echo "  Droplet:     ${DROPLET_ID}"
echo "  Public IP:   ${RESERVED_IP}"
echo "  SSH:         ssh -i ${KEY_FILE} root@${RESERVED_IP}"
echo ""
echo "  ┌─────────────────────────────────────────────────────┐"
echo "  │  NEXT STEP: Point your DNS A record                │"
echo "  │                                                     │"
echo "  │    ${DOMAIN}  →  ${RESERVED_IP}             "
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
