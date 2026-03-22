import { spawn } from "node:child_process";
import ora from "ora";

/**
 * Generate the cloud-init user-data script with the domain substituted in.
 * This is the server-side bootstrap script that runs on first boot.
 */
export function cloudInitScript(
  domain: string,
  repoUrl = "https://github.com/aimxlabs/hookd.git",
): string {
  return `#!/bin/bash
# cloud-init.sh — Bootstrap a fresh Ubuntu server into a running hookd instance.
#
# This script is designed to run as user-data on a new VM (EC2, Droplet, etc).
# It installs Docker, clones hookd, and starts the server with Caddy for HTTPS.

set -euo pipefail

HOOKD_DOMAIN="${domain}"

echo "==> hookd cloud-init starting"
echo "    Domain: ${domain}"

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
  git clone ${repoUrl} "$HOOKD_DIR"
else
  echo "==> Updating hookd..."
  cd "$HOOKD_DIR" && git pull
fi

cd "$HOOKD_DIR"

# Generate an admin token for channel management
HOOKD_ADMIN_TOKEN=$(openssl rand -hex 32)

# Write .env
cat > .env <<ENVEOF
HOOKD_DOMAIN=${domain}
HOOKD_ADMIN_TOKEN=\${HOOKD_ADMIN_TOKEN}
ENVEOF

echo "==> Starting hookd with domain ${domain}..."
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
echo "\${HOOKD_ADMIN_TOKEN}" > "\${TOKEN_FILE}"
chmod 600 "\${TOKEN_FILE}"

echo ""
echo "========================================"
echo "  hookd is deployed!"
echo ""
echo "  Health check:  https://${domain}/health"
echo "  Webhook URL:   https://${domain}/h/<channelId>"
echo ""
echo "  Note: HTTPS will work once DNS is pointing"
echo "  to this server's IP address."
echo ""
echo "  The admin token is saved to: \${TOKEN_FILE}"
echo "  Retrieve it with: sudo cat \${TOKEN_FILE}"
echo ""
echo "  Use it with: hookd channel create -n <name> --admin-token <token>"
echo ""
echo "  Logs:   cd /opt/hookd && docker compose logs -f"
echo "  Update: cd /opt/hookd && git pull && docker compose up -d --build"
echo "========================================"
`;
}

/** Run a local command and capture its stdout. Rejects on non-zero exit or spawn error. */
export function run(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout!.on("data", (d: Buffer) => (stdout += d));
    proc.stderr!.on("data", (d: Buffer) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }),
    );
  });
}

/** Run a local command, inheriting stdio (for long-running commands). */
export function runInherit(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Poll http://<ip>:80/health with a Host header until it returns 200.
 * Used during deploy before DNS/TLS is set up.
 */
export async function waitForHealthIP(
  ip: string,
  domain: string,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<boolean> {
  const spinner = ora("Waiting for hookd to come online...").start();
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://${ip}/health`, {
        headers: { Host: domain },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        spinner.succeed("hookd is online");
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  spinner.warn("Health check timed out — hookd may still be starting");
  return false;
}
