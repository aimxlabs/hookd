#!/bin/bash
# cloud-init.sh — Bootstrap a fresh Ubuntu server into a running hookd instance.
#
# This script is designed to run as user-data on a new VM (EC2, Droplet, etc).
# It installs Docker, clones hookd, and starts the server with Caddy for HTTPS.
#
# Required environment variable (passed via sed replacement before use):
#   HOOKD_DOMAIN — your domain name (e.g. hookd.example.com)
#
# Usage:
#   As cloud-init user-data (AWS/DO will run this on first boot as root):
#     sed "s/HOOKD_DOMAIN=.*/HOOKD_DOMAIN=${YOUR_DOMAIN}/" cloud-init.sh
#
#   Or SSH in and run manually:
#     export HOOKD_DOMAIN=hookd.example.com
#     sudo -E bash cloud-init.sh

set -euo pipefail

HOOKD_DOMAIN="${HOOKD_DOMAIN:-hookd.example.com}"
HOOKD_REPO="${HOOKD_REPO:-https://github.com/aimxlabs/hookd.git}"

echo "==> hookd cloud-init starting"
echo "    Domain: ${HOOKD_DOMAIN}"

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

# ── Clone and configure hookd ──────────────────────────────────────
HOOKD_DIR="/opt/hookd"
if [ ! -d "$HOOKD_DIR" ]; then
  echo "==> Cloning hookd..."
  apt-get install -y git
  git clone "$HOOKD_REPO" "$HOOKD_DIR"
else
  echo "==> Updating hookd..."
  cd "$HOOKD_DIR" && git pull
fi

cd "$HOOKD_DIR"

# Generate an admin token for channel management
HOOKD_ADMIN_TOKEN=$(openssl rand -hex 32)

# Write .env
cat > .env <<ENVEOF
HOOKD_DOMAIN=${HOOKD_DOMAIN}
HOOKD_ADMIN_TOKEN=${HOOKD_ADMIN_TOKEN}
ENVEOF

echo "==> Starting hookd with domain ${HOOKD_DOMAIN}..."
docker compose up -d --build

# Wait for health check
echo "==> Waiting for hookd to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:4801/health >/dev/null 2>&1; then
    echo "==> hookd is running!"
    break
  fi
  sleep 2
done

# Save admin token to a file readable only by root, rather than echoing to logs
TOKEN_FILE="/opt/hookd/.admin-token"
echo "${HOOKD_ADMIN_TOKEN}" > "${TOKEN_FILE}"
chmod 600 "${TOKEN_FILE}"

echo ""
echo "========================================"
echo "  hookd is deployed!"
echo ""
echo "  Health check:  https://${HOOKD_DOMAIN}/health"
echo "  Webhook URL:   https://${HOOKD_DOMAIN}/h/<channelId>"
echo ""
echo "  Note: HTTPS will work once DNS is pointing"
echo "  to this server's IP address."
echo ""
echo "  The admin token is saved to: ${TOKEN_FILE}"
echo "  Retrieve it with: sudo cat ${TOKEN_FILE}"
echo ""
echo "  Use it with: hookd channel create -n <name> --admin-token <token>"
echo ""
echo "  Logs:   cd /opt/hookd && docker compose logs -f"
echo "  Update: cd /opt/hookd && git pull && docker compose up -d --build"
echo "========================================"
