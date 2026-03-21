# hookr

Webhook relay for AI agents. Receive, verify, and forward webhooks in real-time over WebSocket.

AI agents can't easily receive webhooks — they don't run stable HTTP servers. **hookr** bridges this gap: it receives webhooks on behalf of agents and pushes them in real-time via WebSocket.

## Quick Start

The hookr server typically runs on a cloud server (AWS, DigitalOcean, etc.) so it can receive webhooks from the internet. You connect to it from your local machine.

**On your server (3 commands):**

```bash
git clone https://github.com/aimxlabs/hookr.git && cd hookr
cp .env.example .env    # edit: set HOOKR_DOMAIN=your-domain.com
docker compose up -d
```

**On your local machine:**

```bash
npm install -g hookr

# Guided setup — creates a channel, saves your server URL and token
hookr setup -s https://hookr.example.com

# Start receiving events
hookr listen ch_a1b2c3d4 --target http://localhost:8080/webhook
# => Connected! Forwarding events to http://localhost:8080/webhook...
```

**Or for local development (everything on one machine):**

```bash
hookr serve &
hookr channel create --name my-github
hookr listen ch_a1b2c3d4 --target http://localhost:8080/webhook
```

## How It Works

```
GitHub/Stripe/etc.  →  hookr server  →  WebSocket     →  hookr listen  →  your local app
     (POST)            (stores event)    (real-time)       (persistent)     (localhost)
                                      →  HTTP poll     →  hookr poll    →  cron job
                                         (on-demand)      (one-shot)
                                      →  HTTP callback →  POST to URL
                                         (fallback)
```

1. Create a **channel** — get a unique webhook URL
2. Point your provider (GitHub, Stripe, etc.) at the webhook URL
3. Consume events via any of three delivery modes:
   - **`hookr listen`** — real-time WebSocket push (persistent connection)
   - **`hookr poll`** — HTTP polling (cron-friendly, no persistent connection)
   - **HTTP callback** — hookr POSTs to a URL you configure
4. Events are stored for replay and retry if delivery fails

## Commands

```
hookr setup                    Guided setup — connect to server and create a channel
hookr serve                    Start the hookr server
  -p, --port <port>            Port (default: 4801)
  --host <host>                Host (default: 0.0.0.0)
  --db <path>                  SQLite database path (default: hookr.db)
  --public-url <url>           Public URL (for correct URLs in logs)

hookr channel create           Create a new webhook channel
  -n, --name <name>            Channel name (required)
  --provider <provider>        github | stripe | slack | generic
  --secret <secret>            Webhook signing secret
  --callback-url <url>         HTTP fallback URL
  --admin-token <token>        Admin token (or set HOOKR_ADMIN_TOKEN)

hookr channel list             List all channels
hookr channel delete <id>      Delete a channel
  --admin-token <token>        Admin token (or set HOOKR_ADMIN_TOKEN)
hookr channel inspect <id>     Show recent events
  --token <token>              Channel auth token

hookr listen <channelId>       Listen for events and forward them
  -t, --target <url>           Local URL (default: http://localhost:3000)
  --json                       Output JSON to stdout
  --token <token>              Auth token

hookr poll <channelId>         Poll for pending events (cron-friendly)
  -t, --target <url>           Forward events to this URL
  --limit <n>                  Max events per poll (default: 100)
  --after <eventId>            Cursor: only events after this ID
  --no-ack                     Don't auto-acknowledge fetched events
  --token <token>              Auth token

hookr login <token>            Save server URL and auth token
  -s, --server <url>           Server URL to save
```

### Configuration

All commands resolve the server URL and auth token in this order:

1. **CLI flags** (`--server`, `--token`) — highest priority
2. **Environment variables** (`HOOKR_SERVER`, `HOOKR_TOKEN`)
3. **Config file** (`~/.hookr/config.json`) — saved by `hookr login` or `hookr setup`
4. **Default** — `http://localhost:4801`

Once you run `hookr login <token> -s https://your-server.com`, you won't need to pass `--server` or `--token` again.

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
GET    /api/channels              List channels              (public)
GET    /api/channels/:id          Get channel details        (public, no secrets)
DELETE /api/channels/:id          Delete a channel           (admin token)
GET    /api/channels/:id/events   Recent events              (channel token)
GET    /api/channels/:id/poll     Poll for undelivered events (channel token)
POST   /api/channels/:id/ack     Acknowledge polled events   (channel token)

POST   /h/:channelId             Receive webhook (give this URL to providers)
GET    /ws                       WebSocket endpoint for agents
GET    /health                   Health check
```

**Authentication:** Endpoints marked "admin token" require `HOOKR_ADMIN_TOKEN` (via `Authorization: Bearer <token>` header). If no admin token is configured on the server, these endpoints are unrestricted. Endpoints marked "channel token" require the channel's auth token (returned when the channel is created).

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

hookr is designed for a split setup: the **server** runs on a cloud machine with a public IP, and you **connect from your local machine** (or agent) to receive events.

**One-command deploy scripts** are available for AWS and DigitalOcean — see **[DEPLOY.md](./DEPLOY.md)** for full step-by-step instructions (designed to be followed by an AI agent with cloud API credentials).

### Docker deployment (recommended)

**Prerequisites:**
- A VPS (AWS EC2, DigitalOcean droplet, etc.) with Docker installed
- A domain name with a DNS A record pointing to the server's IP

**Deploy:**

```bash
git clone https://github.com/aimxlabs/hookr.git && cd hookr
cp .env.example .env
# Edit .env — set HOOKR_DOMAIN and HOOKR_ADMIN_TOKEN
docker compose up -d
```

That's it. Caddy automatically provisions HTTPS via Let's Encrypt. Visit `https://your-domain.com/health` to verify.

> **Tip:** Generate an admin token with `openssl rand -hex 32` and set it as `HOOKR_ADMIN_TOKEN` in `.env`. Without it, channel create/delete endpoints are unrestricted.

**Managing your server:**

```bash
# View logs
docker compose logs -f hookr

# Update to latest version
git pull && docker compose up -d --build

# Backup the database
docker compose exec hookr node -e "
  require('child_process').execSync('cp /data/hookr.db /data/hookr-backup.db')
"
```

### Connecting from your local machine

```bash
# Guided setup — creates a channel, saves server URL and token
hookr setup -s https://your-domain.com

# All future commands use the saved config automatically
hookr channel list
hookr listen ch_a1b2c3d4 --target http://localhost:3000
hookr poll ch_a1b2c3d4
```

Or save config manually:

```bash
hookr login tok_xyz789 -s https://your-domain.com
```

### Environment variables

For CI/CD, Docker, or cron, use environment variables instead of the config file:

```bash
export HOOKR_SERVER=https://hookr.example.com
export HOOKR_TOKEN=tok_xyz789                  # channel auth token (for listen/poll/inspect)
export HOOKR_ADMIN_TOKEN=<your-admin-token>    # admin token (for channel create/delete)

hookr poll ch_a1b2c3d4 --target http://localhost:3000
```

### Manual deployment (without Docker)

If you prefer not to use Docker:

```bash
npm install -g hookr
hookr serve --public-url https://hookr.example.com
```

You'll need to put hookr behind a reverse proxy (Nginx, Caddy) for HTTPS and manage the process yourself (systemd, pm2, etc.).

## Integration Guides

hookr is designed as the webhook ingress layer for self-hosted AI agents. Below are step-by-step guides for the most popular agent frameworks.

### OpenClaw (Clawdbot)

OpenClaw's Gateway has a built-in hooks endpoint, but it only supports bearer-token auth — it can't verify GitHub/Stripe HMAC signatures natively. hookr handles signature verification and forwards verified payloads to the Gateway.

**Flow:** `GitHub → hookr (cloud) → hookr listen (local) → OpenClaw Gateway (local)`

```bash
# 1. On your server — start hookr
hookr serve --public-url https://hookr.example.com

# 2. On your local machine — run guided setup
hookr setup -s https://hookr.example.com
# => walks you through creating a channel with GitHub provider + signing secret
# => saves server URL and token automatically

# 3. Forward events to OpenClaw's Gateway hooks endpoint
hookr listen ch_a1b2c3d4 --target http://127.0.0.1:18789/hooks/wake
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

Finally, point GitHub's webhook settings at your hookr URL (`http://your-server:4801/h/ch_a1b2c3d4`). hookr verifies the HMAC-SHA256 signature, then forwards the raw payload to OpenClaw. The Gateway receives it as a wake event and triggers your agent.

**Alternative: Cron-based polling** — if you can't keep a persistent WebSocket connection:

```bash
# Run every minute via cron — fetches pending events, forwards to OpenClaw, auto-acks
*/1 * * * * hookr poll ch_a1b2c3d4 --target http://127.0.0.1:18789/hooks/wake
```

> **Tip:** For Stripe or Slack, just change `--provider stripe` or `--provider slack` and set the matching signing secret. hookr handles each provider's signature format.

### nanobot

nanobot doesn't have an HTTP webhook receiver yet (it's [on the roadmap](https://github.com/HKUDS/nanobot/discussions/431)). hookr fills this gap with two approaches.

**Option A: JSON stdout** — pipe events into a handler script

```bash
# After running hookr setup (saves server URL + token)
hookr listen ch_a1b2c3d4 --json \
  | while IFS= read -r event; do
      # Extract the event body and pass it to nanobot
      echo "$event" | jq -r '.body' | nanobot run --stdin
    done
```

Each webhook event is emitted as a single JSON line with fields `eventId`, `channelId`, `headers`, `body`, `method`, and `ip`.

**Option B: HTTP callback** — use hookr's built-in fallback

If you run a small local HTTP server that bridges to nanobot, you can skip the CLI entirely:

```bash
# Create a channel with a callback URL (no hookr listen needed)
hookr channel create \
  --name stripe-payments \
  --provider stripe \
  --secret "$STRIPE_WEBHOOK_SECRET" \
  --callback-url http://127.0.0.1:9090/nanobot-bridge
```

When no WebSocket client is connected, hookr POSTs verified events directly to the callback URL with `X-Hookr-Event-Id` and `X-Hookr-Channel-Id` headers.

**Option C: Cron polling** — no persistent process needed at all

```bash
# Poll every 5 minutes, pipe events to nanobot (uses saved config)
*/5 * * * * hookr poll ch_a1b2c3d4 \
  | while IFS= read -r event; do echo "$event" | jq -r '.body' | nanobot run --stdin; done
```

### Any Agent (Generic Pattern)

hookr works with any agent framework. Pick the delivery mode that fits:

| Mode | Command | Best for |
|------|---------|----------|
| WebSocket | `hookr listen` | Real-time agents with persistent connections |
| HTTP poll | `hookr poll` | Cron jobs, serverless, ephemeral agents |
| HTTP callback | `--callback-url` | Agents with their own HTTP server |

**Programmatic usage** — embed hookr in your own agent process:

```typescript
import { createApp, startServer } from "hookr";

// Start hookr as part of your agent
await startServer({ port: 4801, dbPath: "hookr.db" });

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
