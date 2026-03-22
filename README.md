# hookd

Webhook relay for AI agents. Receive, verify, and forward webhooks to locally running agents.

AI agents can't receive webhooks — they usually don't run stable HTTP servers, and are often behind firewalls preventing external services from talking directly to them. **hookd** bridges this gap: deploy a cloud relay server, and webhooks from GitHub, Stripe, and Slack, for example, get verified and forwarded to your local agent in real-time.

## Quick Start

The fastest way to get hookd running is with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and the built-in `/deploy-hookd` skill. It handles everything end-to-end — server provisioning, DNS, HTTPS, webhook channels, provider configuration, and verification.

**Prerequisites:** Cloud credentials configured ([AWS](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) `aws configure` or [DigitalOcean](https://docs.digitalocean.com/reference/doctl/how-to/install/) `doctl auth init`) and a domain name.

```bash
git clone https://github.com/aimxlabs/hookd.git && cd hookd
```

Then open Claude Code in the repo folder and type:

```
/deploy-hookd
```

The skill will walk you through setup and autonomously:

- Detect your cloud credentials and ask for a domain
- Deploy the server (AWS EC2 or DigitalOcean Droplet)
- Configure DNS and wait for HTTPS (Let's Encrypt via Caddy)
- Install the CLI and create a webhook channel with signature verification
- Configure your webhook provider (GitHub, Stripe, or Slack)
- Verify the full pipeline end-to-end and report a summary

Once deployed, forward events to your local agent (like OpenClaw):

```bash
hookd listen <channel-id> --target http://127.0.0.1:18789/hooks/wake
```

## How It Works

1. Create a **channel** — get a unique webhook URL
2. Point your 3rd party service (GitHub, Stripe, etc.) at the webhook URL
3. From your local machine, consume webhook events via any of three delivery modes:
   - **`hookd listen`** — real-time WebSocket push (persistent connection)
   - **`hookd poll`** — HTTP polling (cron-friendly, no persistent connection)
   - **HTTP callback** — hookd POSTs to a URL you configure
4. Events are stored for replay and retry if delivery fails

## Features

- **Real-time delivery** via WebSocket with automatic reconnection
- **Signature verification** for GitHub (HMAC-SHA256), Stripe, and Slack
- **Event storage** in SQLite for replay and debugging
- **At-least-once delivery** with ack protocol and retry logic
- **HTTP callback fallback** when no WebSocket client is connected
- **HTTP polling** for cron-based agents that can't maintain connections
- **Self-hosted** — single binary, zero external dependencies

## Commands

```
hookd setup                    Guided setup — connect to server, create channel
hookd listen <channelId>       Forward events to a local URL via WebSocket
hookd poll <channelId>         Poll for pending events (cron-friendly)
hookd channel create           Create a new webhook channel
hookd channel list             List all channels
hookd channel delete <id>      Delete a channel
hookd channel inspect <id>     Show recent events for a channel
hookd deploy aws|digitalocean  Deploy to cloud (see DEPLOY.md)
hookd manage status|logs|...   Manage remote server (see DEPLOY.md)
hookd serve                    Start hookd server locally
hookd login <token>            Save server URL and auth token
```

Run `hookd --help` or `hookd <command> --help` for all options and flags.

### Configuration

All commands resolve the server URL and auth token in this order:

1. **CLI flags** (`--server`, `--token`) — highest priority
2. **Environment variables** (`HOOKD_SERVER`, `HOOKD_TOKEN`)
3. **Config file** (`~/.hookd/config.json`) — saved by `hookd login` or `hookd setup`
4. **Default** — `http://localhost:4801`

Once you run `hookd login <token> -s https://your-server.com`, you won't need to pass `--server` or `--token` again.

## Integration Guides

### OpenClaw (Clawdbot)

The [Quick Start](#quick-start) above covers the full deployment workflow. Once hookd is running, forward verified webhooks to OpenClaw's Gateway:

```bash
hookd listen <channel-id> --target http://127.0.0.1:18789/hooks/wake
```

Configure OpenClaw to accept forwarded events in `~/.openclaw/openclaw.json`:

```json
{
  "hooks": {
    "enabled": true,
    "token": "your-openclaw-hook-token",
    "path": "/hooks"
  }
}
```

Point GitHub's webhook settings at your hookd URL (`https://hookd.example.com/h/<channel-id>`). hookd verifies the HMAC-SHA256 signature, then forwards the raw payload to OpenClaw. The Gateway receives it as a wake event and triggers your agent.

**Cron-based polling** — if you can't keep a persistent WebSocket connection:

```bash
*/1 * * * * hookd poll <channel-id> --target http://127.0.0.1:18789/hooks/wake
```

### nanobot

nanobot doesn't have an HTTP webhook receiver yet. hookd fills this gap:

**JSON stdout** — pipe events into a handler script:

```bash
hookd listen <channel-id> --json \
  | while IFS= read -r event; do
      echo "$event" | jq -r '.body' | nanobot run --stdin
    done
```

**HTTP callback** — skip the CLI entirely:

```bash
hookd channel create \
  --name stripe-payments \
  --provider stripe \
  --secret "$STRIPE_WEBHOOK_SECRET" \
  --callback-url http://127.0.0.1:9090/nanobot-bridge
```

When no WebSocket client is connected, hookd POSTs verified events directly to the callback URL.

**Cron polling:**

```bash
*/5 * * * * hookd poll <channel-id> \
  | while IFS= read -r event; do echo "$event" | jq -r '.body' | nanobot run --stdin; done
```

### Any Agent (Generic Pattern)

| Mode | Command | Best for |
|------|---------|----------|
| WebSocket | `hookd listen` | Real-time agents with persistent connections |
| HTTP poll | `hookd poll` | Cron jobs, serverless, ephemeral agents |
| HTTP callback | `--callback-url` | Agents with their own HTTP server |

**Programmatic usage:**

```typescript
import { createApp, startServer } from "hookd";

// Start hookd as part of your agent
await startServer({ port: 4801, dbPath: "hookd.db" });

// Or mount the Hono app inside your own server
const { app, injectWebSocket } = createApp();
```

**WebSocket client:**

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
    handleWebhook(msg.body, msg.headers);
    ws.send(JSON.stringify({ type: "ack", eventId: msg.eventId }));
  }
});
```

## Manual Deployment

If you prefer to deploy without Claude Code, see **[DEPLOY.md](./DEPLOY.md)** for:

- One-command CLI deploy (`hookd deploy aws` / `hookd deploy digitalocean`)
- Step-by-step manual deployment with Docker or without
- Server management (`hookd manage`)
- Environment variables for CI/CD
- Troubleshooting

## API

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

**Authentication:** Endpoints marked "admin token" require `HOOKD_ADMIN_TOKEN` (via `Authorization: Bearer <token>` header). Endpoints marked "channel token" require the channel's auth token (returned when the channel is created).

### WebSocket Protocol

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

## Architecture

- **Server**: [Hono](https://hono.dev/) HTTP + WebSocket on Node.js
- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [Drizzle ORM](https://orm.drizzle.team/)
- **CLI**: [Commander.js](https://github.com/tj/commander.js)

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
