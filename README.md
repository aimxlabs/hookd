# hookd

Webhook relay for AI agents. Receive, verify, and forward webhooks in real-time over WebSocket.

AI agents can't easily receive webhooks — they don't run stable HTTP servers. **hookd** bridges this gap: it receives webhooks on behalf of agents and pushes them in real-time via WebSocket.

## Quick Start

The hookd server typically runs on a cloud server (AWS, DigitalOcean, etc.) so it can receive webhooks from the internet. You connect to it from your local machine.

**On your server (3 commands):**

```bash
git clone https://github.com/aimxlabs/hookd.git && cd hookd
cp .env.example .env    # edit: set HOOKD_DOMAIN and HOOKD_ADMIN_TOKEN
docker compose up -d
```

**On your local machine:**

```bash
npm install -g hookd

# Guided setup — creates a channel, saves your server URL and token
hookd setup -s https://hookd.example.com

# Start receiving events
hookd listen ch_a1b2c3d4 --target http://localhost:8080/webhook
# => Connected! Forwarding events to http://localhost:8080/webhook...
```

**Or for local development (everything on one machine):**

```bash
hookd serve &
hookd channel create --name my-github
hookd listen ch_a1b2c3d4 --target http://localhost:8080/webhook
```

## How It Works

```
GitHub/Stripe/etc.  →  hookd server  →  WebSocket     →  hookd listen  →  your local app
     (POST)            (stores event)    (real-time)       (persistent)     (localhost)
                                      →  HTTP poll     →  hookd poll    →  cron job
                                         (on-demand)      (one-shot)
                                      →  HTTP callback →  POST to URL
                                         (fallback)
```

1. Create a **channel** — get a unique webhook URL
2. Point your provider (GitHub, Stripe, etc.) at the webhook URL
3. Consume events via any of three delivery modes:
   - **`hookd listen`** — real-time WebSocket push (persistent connection)
   - **`hookd poll`** — HTTP polling (cron-friendly, no persistent connection)
   - **HTTP callback** — hookd POSTs to a URL you configure
4. Events are stored for replay and retry if delivery fails

## Commands

```
hookd setup                    Guided setup — connect to server and create a channel
hookd serve                    Start the hookd server
  -p, --port <port>            Port (default: 4801)
  --host <host>                Host (default: 0.0.0.0)
  --db <path>                  SQLite database path (default: hookd.db)
  --public-url <url>           Public URL (for correct URLs in logs)

hookd channel create           Create a new webhook channel
  -n, --name <name>            Channel name (required)
  --provider <provider>        github | stripe | slack | generic
  --secret <secret>            Webhook signing secret
  --callback-url <url>         HTTP fallback URL
  --admin-token <token>        Admin token (or set HOOKD_ADMIN_TOKEN)

hookd channel list             List all channels
  --admin-token <token>        Admin token (or set HOOKD_ADMIN_TOKEN)
hookd channel delete <id>      Delete a channel
  --admin-token <token>        Admin token (or set HOOKD_ADMIN_TOKEN)
hookd channel inspect <id>     Show recent events
  --token <token>              Channel auth token

hookd listen <channelId>       Listen for events and forward them
  -t, --target <url>           Local URL (default: http://localhost:3000)
  --json                       Output JSON to stdout
  --token <token>              Auth token

hookd poll <channelId>         Poll for pending events (cron-friendly)
  -t, --target <url>           Forward events to this URL
  --limit <n>                  Max events per poll (default: 100)
  --after <eventId>            Cursor: only events after this ID
  --no-ack                     Don't auto-acknowledge fetched events
  --token <token>              Auth token

hookd login <token>            Save server URL and auth token
  -s, --server <url>           Server URL to save

hookd deploy <command>         Provision or tear down a cloud hookd server
  aws <domain> [region]        Deploy to AWS EC2 (~$4-9/month, ~5 min)
    --instance-type <type>     EC2 instance type (default: t3.small)
    --key-name <name>          SSH key pair name (default: hookd-deploy-key)
    --sg-name <name>           Security group name (default: hookd-server)
    --vpc-id <id>              VPC ID (defaults to default VPC)
    --subnet-id <id>           Subnet ID (for non-default VPCs)
  digitalocean <domain> [region]  Deploy to DigitalOcean (~$6/month, ~3 min)
    --size <size>              Droplet size slug (default: s-1vcpu-1gb)
    --name <name>              Droplet name (default: hookd-server)
  teardown <provider> [region] Destroy server and all cloud resources

hookd manage <command>         Manage a remote hookd server via SSH
  --host <host>                Server hostname or IP (or set HOOKD_HOST)
  --key <path>                 SSH private key path
  --user <name>                SSH user (default: ubuntu)
  --dir <path>                 Remote hookd directory (default: /opt/hookd)

  Subcommands:
    init                       Save SSH connection details
    status                     Server status, health, and disk usage
    start / stop / restart     Container lifecycle
    update                     Pull latest code, rebuild, restart
    logs                       View container logs (follows by default)
      --lines <n>              Lines to show (default: 100)
      --no-follow              Don't follow log output
    backup                     Download database backup
      --output <path>          Local path for backup file
    restore <file>             Upload and restore a database backup
    ssh                        Open interactive SSH session
    cleanup                    Remove unused Docker images/volumes
    domain <name>              Update server domain name
    env                        Show server environment variables
```

### Configuration

All commands resolve the server URL and auth token in this order:

1. **CLI flags** (`--server`, `--token`) — highest priority
2. **Environment variables** (`HOOKD_SERVER`, `HOOKD_TOKEN`)
3. **Config file** (`~/.hookd/config.json`) — saved by `hookd login` or `hookd setup`
4. **Default** — `http://localhost:4801`

Once you run `hookd login <token> -s https://your-server.com`, you won't need to pass `--server` or `--token` again.

## Features

- **Real-time delivery** via WebSocket with automatic reconnection
- **Signature verification** for GitHub (HMAC-SHA256), Stripe, and Slack
- **Event storage** in SQLite for replay and debugging
- **At-least-once delivery** with ack protocol and retry logic
- **HTTP callback fallback** when no WebSocket client is connected
- **HTTP polling** for cron-based agents that can't maintain connections
- **Self-hosted** — single binary, zero external dependencies

## Architecture

- **Server**: [Hono](https://hono.dev/) HTTP + WebSocket on Node.js
- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [Drizzle ORM](https://orm.drizzle.team/)
- **CLI**: [Commander.js](https://github.com/tj/commander.js)

### API

The server exposes a REST API for channel management:

```
POST   /api/channels              Create a channel           (admin token)
GET    /api/channels              List channels              (admin token)
GET    /api/channels/:id          Get channel details        (admin token)
DELETE /api/channels/:id          Delete a channel           (admin token)
GET    /api/channels/:id/events   Recent events              (channel token)
GET    /api/channels/:id/poll     Poll for undelivered events (channel token)
POST   /api/channels/:id/ack     Acknowledge polled events   (channel token)

POST   /h/:channelId             Receive webhook (give this URL to providers)
GET    /ws                       WebSocket endpoint for agents
GET    /health                   Health check
```

**Authentication:** Endpoints marked "admin token" require `HOOKD_ADMIN_TOKEN` (via `Authorization: Bearer <token>` header). If no admin token is configured on the server, these endpoints are unrestricted. Endpoints marked "channel token" require the channel's auth token (returned when the channel is created).

### WebSocket Protocol

Agents connect via WebSocket and subscribe to channels:

```jsonc
// Client sends
{ "type": "auth", "token": "tok_..." }
{ "type": "subscribe", "channelId": "ch_..." }
{ "type": "ack", "eventId": "evt_..." }

// Server sends
{ "type": "auth_ok" }
{ "type": "subscribed", "channelId": "ch_..." }
{ "type": "event", "eventId": "evt_...", "channelId": "ch_...", "headers": {...}, "body": "...", "method": "POST", "ip": "..." }
```

## Deploying to the Cloud

hookd is designed for a split setup: the **server** runs on a cloud machine with a public IP, and you **connect from your local machine** (or agent) to receive events.

**One-command deploy** via the CLI for AWS and DigitalOcean — see **[DEPLOY.md](./DEPLOY.md)** for full step-by-step instructions (designed to be followed by an AI agent with cloud API credentials).

```bash
# Deploy to AWS EC2
hookd deploy aws hookd.example.com

# Deploy to DigitalOcean
hookd deploy digitalocean hookd.example.com
```

### Docker deployment (recommended)

**Prerequisites:**
- A VPS (AWS EC2, DigitalOcean droplet, etc.) with Docker installed
- A domain name with a DNS A record pointing to the server's IP

**Deploy:**

```bash
git clone https://github.com/aimxlabs/hookd.git && cd hookd
cp .env.example .env
# Edit .env — set HOOKD_DOMAIN and HOOKD_ADMIN_TOKEN
docker compose up -d
```

That's it. Caddy automatically provisions HTTPS via Let's Encrypt. Visit `https://your-domain.com/health` to verify.

> **Tip:** Generate an admin token with `openssl rand -hex 32` and set it as `HOOKD_ADMIN_TOKEN` in `.env`. Without it, channel management endpoints are unrestricted.

**Managing your server:**

```bash
# If you ran hookd setup, manage commands work automatically
hookd manage status
hookd manage logs
hookd manage update
hookd manage backup

# Or specify the host explicitly
hookd manage status --host 1.2.3.4
```

### Connecting from your local machine

```bash
# Guided setup — creates a channel, saves server URL and token
hookd setup -s https://your-domain.com

# All future commands use the saved config automatically
hookd channel list
hookd listen ch_a1b2c3d4 --target http://localhost:3000
hookd poll ch_a1b2c3d4
```

Or save config manually:

```bash
hookd login tok_xyz789 -s https://your-domain.com
```

### Environment variables

For CI/CD, Docker, or cron, use environment variables instead of the config file:

```bash
export HOOKD_SERVER=https://hookd.example.com
export HOOKD_TOKEN=tok_xyz789                  # channel auth token (for listen/poll/inspect)
export HOOKD_ADMIN_TOKEN=<your-admin-token>    # admin token (for channel CRUD)

hookd poll ch_a1b2c3d4 --target http://localhost:3000
```

### Manual deployment (without Docker)

If you prefer not to use Docker:

```bash
npm install -g hookd
hookd serve --public-url https://hookd.example.com
```

You'll need to put hookd behind a reverse proxy (Nginx, Caddy) for HTTPS and manage the process yourself (systemd, pm2, etc.).

## Integration Guides

hookd is designed as the webhook ingress layer for self-hosted AI agents. Below are step-by-step guides for the most popular agent frameworks.

### OpenClaw (Clawdbot)

OpenClaw's Gateway has a built-in hooks endpoint, but it only supports bearer-token auth — it can't verify GitHub/Stripe HMAC signatures natively. hookd handles signature verification and forwards verified payloads to the Gateway.

**Flow:** `GitHub → hookd (cloud) → hookd listen (local) → OpenClaw Gateway (local)`

```bash
# 1. On your server — start hookd
hookd serve --public-url https://hookd.example.com

# 2. On your local machine — run guided setup
hookd setup -s https://hookd.example.com
# => walks you through creating a channel with GitHub provider + signing secret
# => saves server URL and token automatically

# 3. Forward events to OpenClaw's Gateway hooks endpoint
hookd listen ch_a1b2c3d4 --target http://127.0.0.1:18789/hooks/wake
```

Then configure OpenClaw to accept the forwarded events in `~/.openclaw/openclaw.json`:

```json
{
  "hooks": {
    "enabled": true,
    "token": "your-openclaw-hook-token",
    "path": "/hooks"
  }
}
```

Finally, point GitHub's webhook settings at your hookd URL (`https://hookd.example.com/h/ch_a1b2c3d4`). hookd verifies the HMAC-SHA256 signature, then forwards the raw payload to OpenClaw. The Gateway receives it as a wake event and triggers your agent.

**Alternative: Cron-based polling** — if you can't keep a persistent WebSocket connection:

```bash
# Run every minute via cron — fetches pending events, forwards to OpenClaw, auto-acks
*/1 * * * * hookd poll ch_a1b2c3d4 --target http://127.0.0.1:18789/hooks/wake
```

> **Tip:** For Stripe or Slack, just change `--provider stripe` or `--provider slack` and set the matching signing secret. hookd handles each provider's signature format.

### nanobot

nanobot doesn't have an HTTP webhook receiver yet (it's [on the roadmap](https://github.com/HKUDS/nanobot/discussions/431)). hookd fills this gap with two approaches.

**Option A: JSON stdout** — pipe events into a handler script

```bash
# After running hookd setup (saves server URL + token)
hookd listen ch_a1b2c3d4 --json \
  | while IFS= read -r event; do
      # Extract the event body and pass it to nanobot
      echo "$event" | jq -r '.body' | nanobot run --stdin
    done
```

Each webhook event is emitted as a single JSON line with fields `eventId`, `channelId`, `headers`, `body`, `method`, and `ip`.

**Option B: HTTP callback** — use hookd's built-in fallback

If you run a small local HTTP server that bridges to nanobot, you can skip the CLI entirely:

```bash
# Create a channel with a callback URL (no hookd listen needed)
hookd channel create \
  --name stripe-payments \
  --provider stripe \
  --secret "$STRIPE_WEBHOOK_SECRET" \
  --callback-url http://127.0.0.1:9090/nanobot-bridge \
  --admin-token "$HOOKD_ADMIN_TOKEN"
```

When no WebSocket client is connected, hookd POSTs verified events directly to the callback URL with `X-Hookd-Event-Id` and `X-Hookd-Channel-Id` headers.

**Option C: Cron polling** — no persistent process needed at all

```bash
# Poll every 5 minutes, pipe events to nanobot (uses saved config)
*/5 * * * * hookd poll ch_a1b2c3d4 \
  | while IFS= read -r event; do echo "$event" | jq -r '.body' | nanobot run --stdin; done
```

### Any Agent (Generic Pattern)

hookd works with any agent framework. Pick the delivery mode that fits:

| Mode | Command | Best for |
|------|---------|----------|
| WebSocket | `hookd listen` | Real-time agents with persistent connections |
| HTTP poll | `hookd poll` | Cron jobs, serverless, ephemeral agents |
| HTTP callback | `--callback-url` | Agents with their own HTTP server |

**Programmatic usage** — embed hookd in your own agent process:

```typescript
import { createApp, startServer } from "hookd";

// Start hookd as part of your agent
await startServer({ port: 4801, dbPath: "hookd.db" });

// Or mount the Hono app inside your own server
const { app, injectWebSocket } = createApp();
```

**HTTP polling** — fetch events on a schedule (no WebSocket needed):

```typescript
// Poll for events and acknowledge them
const res = await fetch("http://localhost:4801/api/channels/ch_.../poll", {
  headers: { Authorization: "Bearer tok_..." },
});
const { events, cursor } = await res.json();

for (const evt of events) {
  await processWebhook(evt.body, evt.headers);
}

// Acknowledge so they aren't returned on next poll
if (events.length > 0) {
  await fetch("http://localhost:4801/api/channels/ch_.../ack", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer tok_...",
    },
    body: JSON.stringify({ eventIds: events.map((e) => e.id) }),
  });
}
```

**WebSocket client** — connect directly from your agent code:

```typescript
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:4801/ws");
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", token: "tok_..." }));
  ws.send(JSON.stringify({ type: "subscribe", channelId: "ch_..." }));
});
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "event") {
    // Process the webhook payload
    handleWebhook(msg.body, msg.headers);
    // Acknowledge to prevent retries
    ws.send(JSON.stringify({ type: "ack", eventId: msg.eventId }));
  }
});
```

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
