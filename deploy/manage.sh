#!/bin/bash
# deploy/manage.sh — Manage a cloud-hosted hookr installation.
#
# NOTE: Most commands have moved to the hookr CLI: `hookr manage <command>`
# This script is kept for `teardown` (AWS/DigitalOcean resource cleanup) only.
# See: hookr manage --help
#
# Run from your LOCAL machine to manage a remote hookr server via SSH,
# or run directly ON the server for local management.
#
# Usage:
#   ./deploy/manage.sh <command> [options]
#
# Commands:
#   status      Show server status, container health, and disk usage
#   start       Start hookr containers
#   stop        Stop hookr containers
#   restart     Restart hookr containers
#   update      Pull latest code, rebuild, and restart
#   logs        View container logs (follows by default)
#   backup      Download a backup of the hookr database
#   restore     Upload and restore a database backup
#   ssh         Open an SSH session to the server
#   teardown    Destroy the server and all cloud resources
#
# Remote management (from your local machine):
#   ./deploy/manage.sh status --host 1.2.3.4
#   ./deploy/manage.sh status --host 1.2.3.4 --key ~/.ssh/hookr-deploy-key.pem
#   ./deploy/manage.sh logs --host hookr.example.com --lines 100
#   ./deploy/manage.sh backup --host 1.2.3.4 --output ./hookr-backup.db
#
# Local management (on the server itself):
#   ./deploy/manage.sh status
#   ./deploy/manage.sh update
#   ./deploy/manage.sh logs
#
# Environment variables (alternative to flags):
#   HOOKR_HOST      Server IP or hostname
#   HOOKR_SSH_KEY   Path to SSH private key
#   HOOKR_SSH_USER  SSH user (default: ubuntu)
#   HOOKR_DIR       hookr directory on server (default: /opt/hookr)

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────

HOOKR_HOST="${HOOKR_HOST:-}"
HOOKR_SSH_KEY="${HOOKR_SSH_KEY:-${HOME}/.ssh/hookr-deploy-key.pem}"
HOOKR_SSH_USER="${HOOKR_SSH_USER:-ubuntu}"
HOOKR_DIR="${HOOKR_DIR:-/opt/hookr}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Helpers ────────────────────────────────────────────────────────

usage() {
  sed -n '2,/^$/s/^# //p' "$0"
  exit 1
}

info()  { echo -e "${BLUE}==> ${NC}$*"; }
ok()    { echo -e "${GREEN}==> ${NC}$*"; }
warn()  { echo -e "${YELLOW}==> ${NC}$*"; }
err()   { echo -e "${RED}==> ERROR: ${NC}$*" >&2; }

# Check if we're managing a remote server or running locally
is_remote() {
  [ -n "$HOOKR_HOST" ]
}

# Run a command on the server (remote via SSH, or local)
server_exec() {
  if is_remote; then
    local ssh_opts=(-o StrictHostKeyChecking=no -o ConnectTimeout=10)
    if [ -f "$HOOKR_SSH_KEY" ]; then
      ssh_opts+=(-i "$HOOKR_SSH_KEY")
    fi
    ssh "${ssh_opts[@]}" "${HOOKR_SSH_USER}@${HOOKR_HOST}" "$@"
  else
    eval "$@"
  fi
}

# Run a docker compose command on the server
compose() {
  server_exec "cd ${HOOKR_DIR} && sudo docker compose $*"
}

# ── Parse global flags ─────────────────────────────────────────────

COMMAND="${1:-help}"
shift || true

# Parse flags that can appear anywhere
REMAINING_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)       HOOKR_HOST="$2"; shift 2 ;;
    --key)        HOOKR_SSH_KEY="$2"; shift 2 ;;
    --user)       HOOKR_SSH_USER="$2"; shift 2 ;;
    --dir)        HOOKR_DIR="$2"; shift 2 ;;
    *)            REMAINING_ARGS+=("$1"); shift ;;
  esac
done
set -- "${REMAINING_ARGS[@]+"${REMAINING_ARGS[@]}"}"

# ── Commands ───────────────────────────────────────────────────────

cmd_status() {
  info "hookr server status"
  if is_remote; then
    echo "  Host: ${HOOKR_HOST}"
  else
    echo "  Running locally"
  fi
  echo ""

  info "Container status:"
  compose "ps" 2>/dev/null || { err "Could not connect to server"; return 1; }
  echo ""

  info "Health check:"
  local health
  if is_remote; then
    health=$(curl -sf "https://${HOOKR_HOST}/health" 2>/dev/null || \
             curl -sf "http://${HOOKR_HOST}/health" 2>/dev/null || \
             echo "unreachable")
  else
    health=$(curl -sf "http://localhost:4801/health" 2>/dev/null || echo "unreachable")
  fi
  echo "  $health"
  echo ""

  info "Disk usage:"
  server_exec "df -h / | tail -1 | awk '{print \"  Disk: \" \$3 \" used / \" \$2 \" total (\" \$5 \" full)\"}'"
  echo ""

  info "Docker disk usage:"
  server_exec "sudo docker system df 2>/dev/null" || true
  echo ""

  info "Uptime:"
  compose "ps --format '{{.Name}}: up {{.RunningFor}}'" 2>/dev/null || true
}

cmd_start() {
  info "Starting hookr..."
  compose "up -d"
  ok "hookr started"
  echo ""
  cmd_health_wait
}

cmd_stop() {
  info "Stopping hookr..."
  compose "down"
  ok "hookr stopped"
}

cmd_restart() {
  info "Restarting hookr..."
  compose "restart"
  ok "hookr restarted"
  echo ""
  cmd_health_wait
}

cmd_update() {
  info "Updating hookr..."

  info "Pulling latest code..."
  server_exec "cd ${HOOKR_DIR} && sudo git pull"

  info "Rebuilding containers..."
  compose "up -d --build"

  info "Cleaning up old images..."
  server_exec "sudo docker image prune -f" >/dev/null 2>&1 || true

  ok "hookr updated"
  echo ""
  cmd_health_wait
}

cmd_logs() {
  local lines="${1:-100}"
  local service="${2:-}"

  # Parse --lines flag
  for arg in "$@"; do
    case "$arg" in
      --lines=*) lines="${arg#--lines=}" ;;
      --no-follow) NO_FOLLOW=true ;;
    esac
  done

  if [ "${NO_FOLLOW:-}" = "true" ]; then
    compose "logs --tail ${lines} ${service}"
  else
    info "Showing last ${lines} lines, following... (Ctrl+C to stop)"
    compose "logs --tail ${lines} -f ${service}"
  fi
}

cmd_backup() {
  local output="${1:-hookr-backup-$(date +%Y%m%d-%H%M%S).db}"

  # Parse --output flag
  for arg in "$@"; do
    case "$arg" in
      --output=*) output="${arg#--output=}" ;;
    esac
  done

  info "Creating database backup..."

  # Stop hookr briefly to ensure clean backup
  compose "stop hookr"

  if is_remote; then
    # Copy the database file from the Docker volume
    local tmp="/tmp/hookr-backup-$$.db"
    server_exec "sudo docker cp \$(sudo docker compose -f ${HOOKR_DIR}/docker-compose.yml ps -q hookr 2>/dev/null || echo hookr-hookr-1):/data/hookr.db ${tmp} 2>/dev/null || sudo cp /var/lib/docker/volumes/hookr_hookr-data/_data/hookr.db ${tmp}"

    local ssh_opts=(-o StrictHostKeyChecking=no)
    if [ -f "$HOOKR_SSH_KEY" ]; then
      ssh_opts+=(-i "$HOOKR_SSH_KEY")
    fi
    scp "${ssh_opts[@]}" "${HOOKR_SSH_USER}@${HOOKR_HOST}:${tmp}" "$output"
    server_exec "rm -f ${tmp}"
  else
    sudo docker cp "$(sudo docker compose -f ${HOOKR_DIR}/docker-compose.yml ps -q hookr 2>/dev/null || echo hookr-hookr-1):/data/hookr.db" "$output" 2>/dev/null || \
      sudo cp /var/lib/docker/volumes/hookr_hookr-data/_data/hookr.db "$output"
  fi

  # Restart hookr
  compose "start hookr"

  ok "Backup saved to: ${output}"
  ls -lh "$output"
}

cmd_restore() {
  local input="${1:?Usage: manage.sh restore <backup-file>}"

  if [ ! -f "$input" ]; then
    err "Backup file not found: ${input}"
    exit 1
  fi

  warn "This will replace the current database with the backup."
  warn "The current database will be backed up first."
  echo ""

  info "Stopping hookr..."
  compose "stop hookr"

  info "Backing up current database..."
  cmd_backup --output="hookr-pre-restore-$(date +%Y%m%d-%H%M%S).db" 2>/dev/null || true

  info "Restoring from: ${input}"
  if is_remote; then
    local tmp="/tmp/hookr-restore-$$.db"
    local ssh_opts=(-o StrictHostKeyChecking=no)
    if [ -f "$HOOKR_SSH_KEY" ]; then
      ssh_opts+=(-i "$HOOKR_SSH_KEY")
    fi
    scp "${ssh_opts[@]}" "$input" "${HOOKR_SSH_USER}@${HOOKR_HOST}:${tmp}"
    server_exec "sudo docker cp ${tmp} \$(sudo docker compose -f ${HOOKR_DIR}/docker-compose.yml ps -q hookr 2>/dev/null || echo hookr-hookr-1):/data/hookr.db"
    server_exec "rm -f ${tmp}"
  else
    sudo docker cp "$input" "$(sudo docker compose -f ${HOOKR_DIR}/docker-compose.yml ps -q hookr 2>/dev/null || echo hookr-hookr-1):/data/hookr.db"
  fi

  info "Starting hookr..."
  compose "start hookr"

  ok "Database restored from: ${input}"
  cmd_health_wait
}

cmd_ssh() {
  if ! is_remote; then
    err "SSH requires --host flag (e.g. manage.sh ssh --host 1.2.3.4)"
    exit 1
  fi

  info "Connecting to ${HOOKR_HOST}..."
  local ssh_opts=(-o StrictHostKeyChecking=no)
  if [ -f "$HOOKR_SSH_KEY" ]; then
    ssh_opts+=(-i "$HOOKR_SSH_KEY")
  fi
  ssh "${ssh_opts[@]}" "${HOOKR_SSH_USER}@${HOOKR_HOST}"
}

cmd_teardown() {
  local provider="${1:-}"

  echo ""
  warn "╔══════════════════════════════════════════════════════╗"
  warn "║  THIS WILL PERMANENTLY DESTROY YOUR HOOKR SERVER    ║"
  warn "║  All data, channels, and tokens will be lost.       ║"
  warn "╚══════════════════════════════════════════════════════╝"
  echo ""

  if [ -z "$provider" ]; then
    echo "Which cloud provider?"
    echo "  1) aws"
    echo "  2) digitalocean"
    echo ""
    read -rp "Provider (aws/digitalocean): " provider
  fi

  read -rp "Type 'destroy' to confirm: " confirm
  if [ "$confirm" != "destroy" ]; then
    info "Teardown cancelled."
    exit 0
  fi

  echo ""

  case "$provider" in
    aws)
      cmd_teardown_aws "$@"
      ;;
    digitalocean|do)
      cmd_teardown_digitalocean "$@"
      ;;
    *)
      err "Unknown provider: ${provider}"
      err "Supported: aws, digitalocean"
      exit 1
      ;;
  esac
}

cmd_teardown_aws() {
  local region="${2:-us-east-1}"

  info "Finding hookr EC2 instance..."
  local instance_id
  instance_id=$(aws ec2 describe-instances \
    --region "$region" \
    --filters "Name=tag:Name,Values=hookr-server" "Name=instance-state-name,Values=running,stopped" \
    --query "Reservations[].Instances[0].InstanceId" \
    --output text 2>/dev/null || echo "None")

  if [ "$instance_id" = "None" ] || [ -z "$instance_id" ]; then
    warn "No hookr instance found in ${region}"
  else
    info "Terminating instance: ${instance_id}"
    aws ec2 terminate-instances --region "$region" --instance-ids "$instance_id"
    aws ec2 wait instance-terminated --region "$region" --instance-ids "$instance_id"
    ok "Instance terminated"
  fi

  info "Releasing Elastic IPs..."
  local alloc_ids
  alloc_ids=$(aws ec2 describe-addresses \
    --region "$region" \
    --query "Addresses[?Tags[?Key=='hookr-domain']].AllocationId" \
    --output text 2>/dev/null || echo "")

  # Also check for unassociated IPs from hookr
  if [ -z "$alloc_ids" ]; then
    alloc_ids=$(aws ec2 describe-addresses \
      --region "$region" \
      --query "Addresses[?!AssociationId].AllocationId" \
      --output text 2>/dev/null || echo "")
  fi

  for alloc_id in $alloc_ids; do
    if [ -n "$alloc_id" ] && [ "$alloc_id" != "None" ]; then
      aws ec2 release-address --region "$region" --allocation-id "$alloc_id" 2>/dev/null || true
      info "Released Elastic IP: ${alloc_id}"
    fi
  done

  info "Cleaning up security group..."
  aws ec2 delete-security-group --region "$region" --group-name "hookr-server" 2>/dev/null || true

  info "Cleaning up key pair..."
  aws ec2 delete-key-pair --region "$region" --key-name "hookr-deploy-key" 2>/dev/null || true
  rm -f "${HOME}/.ssh/hookr-deploy-key.pem" 2>/dev/null || true

  echo ""
  ok "AWS teardown complete. All hookr resources removed."
}

cmd_teardown_digitalocean() {
  info "Finding hookr Droplet..."
  local droplet_id
  droplet_id=$(doctl compute droplet list \
    --tag-name hookr \
    --format ID \
    --no-header 2>/dev/null || echo "")

  if [ -z "$droplet_id" ]; then
    warn "No hookr droplet found"
  else
    info "Deleting Droplet: ${droplet_id}"
    doctl compute droplet delete "$droplet_id" --force
    ok "Droplet deleted"
  fi

  info "Releasing reserved IPs..."
  local ips
  ips=$(doctl compute reserved-ip list --format IP,DropletID --no-header 2>/dev/null || echo "")
  echo "$ips" | while read -r ip did; do
    if [ -n "$ip" ] && [ -z "$did" ]; then
      doctl compute reserved-ip delete "$ip" --force 2>/dev/null || true
      info "Released IP: ${ip}"
    fi
  done

  rm -f "${HOME}/.ssh/hookr-deploy-key" "${HOME}/.ssh/hookr-deploy-key.pub" 2>/dev/null || true

  echo ""
  ok "DigitalOcean teardown complete. All hookr resources removed."
}

cmd_health_wait() {
  info "Waiting for health check..."
  for i in $(seq 1 20); do
    local health
    if is_remote; then
      health=$(curl -sf "https://${HOOKR_HOST}/health" 2>/dev/null || \
               curl -sf "http://${HOOKR_HOST}/health" 2>/dev/null || echo "")
    else
      health=$(curl -sf "http://localhost:4801/health" 2>/dev/null || echo "")
    fi

    if [ -n "$health" ]; then
      ok "hookr is healthy: ${health}"
      return 0
    fi
    sleep 3
  done

  warn "Health check timed out — hookr may still be starting."
  warn "Check logs: ./deploy/manage.sh logs --host ${HOOKR_HOST:-localhost}"
  return 1
}

cmd_cleanup() {
  info "Cleaning up Docker resources on server..."

  info "Removing unused images..."
  server_exec "sudo docker image prune -af" 2>/dev/null || true

  info "Removing unused volumes (not hookr data)..."
  server_exec "sudo docker volume prune -f" 2>/dev/null || true

  info "Removing build cache..."
  server_exec "sudo docker builder prune -af" 2>/dev/null || true

  echo ""
  info "Docker disk usage after cleanup:"
  server_exec "sudo docker system df 2>/dev/null" || true

  ok "Cleanup complete"
}

cmd_domain() {
  local new_domain="${1:?Usage: manage.sh domain <new-domain>}"

  info "Changing domain to: ${new_domain}"

  # Update .env on server
  server_exec "cd ${HOOKR_DIR} && sudo sed -i 's/HOOKR_DOMAIN=.*/HOOKR_DOMAIN=${new_domain}/' .env"

  info "Restarting with new domain..."
  compose "down"
  compose "up -d"

  ok "Domain updated to: ${new_domain}"
  echo ""
  warn "Make sure DNS A record for ${new_domain} points to this server!"
  cmd_health_wait
}

cmd_env() {
  info "Current environment:"
  server_exec "cd ${HOOKR_DIR} && cat .env 2>/dev/null || echo 'No .env file found'"
}

# ── Dispatch ───────────────────────────────────────────────────────

case "$COMMAND" in
  status)     cmd_status "$@" ;;
  start)      cmd_start "$@" ;;
  stop)       cmd_stop "$@" ;;
  restart)    cmd_restart "$@" ;;
  update)     cmd_update "$@" ;;
  logs)       cmd_logs "$@" ;;
  backup)     cmd_backup "$@" ;;
  restore)    cmd_restore "$@" ;;
  ssh)        cmd_ssh "$@" ;;
  teardown)   cmd_teardown "$@" ;;
  cleanup)    cmd_cleanup "$@" ;;
  domain)     cmd_domain "$@" ;;
  env)        cmd_env "$@" ;;
  help|--help|-h) usage ;;
  *)
    err "Unknown command: ${COMMAND}"
    echo ""
    usage
    ;;
esac
