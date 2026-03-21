#!/bin/bash
# cloud-init.sh — Bootstrap a fresh Ubuntu server into a running hookr instance.
#
# This script is designed to run as user-data on a new VM (EC2, Droplet, etc).
# It installs Docker, clones hookr, and starts the server with Caddy for HTTPS.
#
# Required environment variable (passed via sed replacement before use):
#   HOOKR_DOMAIN — your domain name (e.g. hookr.example.com)
#
# Usage:
#   As cloud-init user-data (AWS/DO will run this on first boot as root):
#     sed "s/HOOKR_DOMAIN=.*/HOOKR_DOMAIN=${YOUR_DOMAIN}/" cloud-init.sh
#
#   Or SSH in and run manually:
#     export HOOKR_DOMAIN=hookr.example.com
#     sudo -E bash cloud-init.sh

set -euo pipefail

HOOKR_DOMAIN="${HOOKR_DOMAIN:-hookr.example.com}"

echo "==> hookr cloud-init starting"
echo "    Domain: ${HOOKR_DOMAIN}"

# ── Install Docker ──────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "==> Installing Docker..."
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  systemctl start docker
  echo "==> Docker installed"
else
  echo "==> Docker already installed"
fi

# ── Clone and configure hookr ──────────────────────────────────────
HOOKR_DIR="/opt/hookr"
if [ ! -d "$HOOKR_DIR" ]; then
  echo "==> Cloning hookr..."
  apt-get install -y git
  git clone https://github.com/aimxlabs/hookr.git "$HOOKR_DIR"
else
  echo "==> Updating hookr..."
  cd "$HOOKR_DIR" && git pull
fi

cd "$HOOKR_DIR"

# Generate an admin token for channel management
HOOKR_ADMIN_TOKEN=$(openssl rand -hex 32)

# Write .env
cat > .env <<ENVEOF
HOOKR_DOMAIN=${HOOKR_DOMAIN}
HOOKR_ADMIN_TOKEN=${HOOKR_ADMIN_TOKEN}
ENVEOF

echo "==> Starting hookr with domain ${HOOKR_DOMAIN}..."
docker compose up -d --build

# Wait for health check
echo "==> Waiting for hookr to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:4801/health >/dev/null 2>&1; then
    echo "==> hookr is running!"
    break
  fi
  sleep 2
done

# Save admin token to a file readable only by root, rather than echoing to logs
TOKEN_FILE="/opt/hookr/.admin-token"
echo "${HOOKR_ADMIN_TOKEN}" > "${TOKEN_FILE}"
chmod 600 "${TOKEN_FILE}"

echo ""
echo "========================================"
echo "  hookr is deployed!"
echo ""
echo "  Health check:  https://${HOOKR_DOMAIN}/health"
echo "  Webhook URL:   https://${HOOKR_DOMAIN}/h/<channelId>"
echo ""
echo "  Note: HTTPS will work once DNS is pointing"
echo "  to this server's IP address."
echo ""
echo "  The admin token is saved to: ${TOKEN_FILE}"
echo "  Retrieve it with: sudo cat ${TOKEN_FILE}"
echo ""
echo "  Use it with: hookr channel create -n <name> --admin-token <token>"
echo ""
echo "  Logs:   cd /opt/hookr && docker compose logs -f"
echo "  Update: cd /opt/hookr && git pull && docker compose up -d --build"
echo "========================================"
