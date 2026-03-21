# hookr

Webhook relay for AI agents. Receive, verify, and forward webhooks in real-time over WebSocket.

AI agents can't easily receive webhooks — they don't run stable HTTP servers. **hookr** bridges this gap: it receives webhooks on behalf of agents and pushes them in real-time via WebSocket.

## Quick Start

```bash
# Terminal 1: Start the server
npx hookr serve

# Terminal 2: Create a channel and listen
npx hookr channel create --name my-github
# => Channel created: http://localhost:4801/h/ch_a1b2c3d4
# => Copy this URL to your GitHub webhook settings

npx hookr listen ch_a1b2c3d4 --target http://localhost:8080/webhook
# => Connected! Forwarding events to http://localhost:8080/webhook...
# => [12:34:56] POST from 140.82.115.x — push event — 204 (2ms)
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
hookr serve                    Start the hookr server
  -p, --port <port>            Port (default: 4801)
  --host <host>                Host (default: 0.0.0.0)
  --db <path>                  SQLite database path (default: hookr.db)

hookr channel create           Create a new webhook channel
  -n, --name <name>            Channel name (required)
  --provider <provider>        github | stripe | slack | generic
  --secret <secret>            Webhook signing secret
  --callback-url <url>         HTTP fallback URL

hookr channel list             List all channels
hookr channel delete <id>      Delete a channel
hookr channel inspect <id>     Show recent events

hookr listen <channelId>       Listen for events and forward them
  -t, --target <url>           Local URL (default: http://localhost:3000)
  --json                       Output JSON to stdout
  --token <token>              Auth token

hookr poll <channelId>         Poll for pending events (cron-friendly)
  -t, --target <url>           Forward events to this URL
  --limit <n>                  Max events per poll (default: 100)
  --after <eventId>            Cursor: only events after this ID
  --no-ack                     Don't auto-acknowledge fetched events
  --token <token>              Auth token (required)

hookr login <token>            Save auth token
```

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
POST   /api/channels           Create a channel
GET    /api/channels           List channels
GET    /api/channels/:id       Get channel details
DELETE /api/channels/:id       Delete a channel
GET    /api/channels/:id/events  Recent events
GET    /api/channels/:id/poll   Poll for undelivered events (requires auth)
POST   /api/channels/:id/ack    Acknowledge polled events as delivered

POST   /h/:channelId           Receive webhook (this is the URL you give to providers)
GET    /ws                     WebSocket endpoint for agents
GET    /health                 Health check
```

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

## Integration Guides

hookr is designed as the webhook ingress layer for self-hosted AI agents. Below are step-by-step guides for the most popular agent frameworks.

### OpenClaw (Clawdbot)

OpenClaw's Gateway has a built-in hooks endpoint, but it only supports bearer-token auth — it can't verify GitHub/Stripe HMAC signatures natively. hookr handles signature verification and forwards verified payloads to the Gateway.

**Flow:** `GitHub → hookr (public) → hookr listen → OpenClaw Gateway (local)`

```bash
# 1. Start hookr (on a machine with a public IP, or use a tunnel)
hookr serve --port 4801

# 2. Create a channel with signature verification
hookr channel create \
  --name github-deploys \
  --provider github \
  --secret "$GITHUB_WEBHOOK_SECRET"
# => Channel: ch_a1b2c3d4
# => Webhook URL: http://your-server:4801/h/ch_a1b2c3d4
# => Token: tok_xyz789

# 3. Forward events to OpenClaw's Gateway hooks endpoint
hookr listen ch_a1b2c3d4 \
  --target http://127.0.0.1:18789/hooks/wake \
  --token tok_xyz789
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
*/1 * * * * hookr poll ch_a1b2c3d4 --target http://127.0.0.1:18789/hooks/wake --token tok_xyz789
```

> **Tip:** For Stripe or Slack, just change `--provider stripe` or `--provider slack` and set the matching signing secret. hookr handles each provider's signature format.

### nanobot

nanobot doesn't have an HTTP webhook receiver yet (it's [on the roadmap](https://github.com/HKUDS/nanobot/discussions/431)). hookr fills this gap with two approaches.

**Option A: JSON stdout** — pipe events into a handler script

```bash
# 1. Start hookr + create a channel (same as above)
hookr serve --port 4801
hookr channel create --name github-issues --provider github --secret "$SECRET"

# 2. Listen in JSON mode and pipe to a script
hookr listen ch_a1b2c3d4 --json --token tok_xyz789 \
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
# Poll every 5 minutes, pipe events to nanobot
*/5 * * * * hookr poll ch_a1b2c3d4 --token tok_xyz789 \
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
