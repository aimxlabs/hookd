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
GitHub/Stripe/etc.  →  hookr server  →  WebSocket  →  hookr listen  →  your local app
     (POST)            (stores event)    (real-time)    (CLI agent)      (localhost)
```

1. Create a **channel** — get a unique webhook URL
2. Point your provider (GitHub, Stripe, etc.) at the webhook URL
3. Run `hookr listen` — events are pushed to your local app in real-time
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

hookr login <token>            Save auth token
```

## Features

- **Real-time delivery** via WebSocket with automatic reconnection
- **Signature verification** for GitHub (HMAC-SHA256), Stripe, and Slack
- **Event storage** in SQLite for replay and debugging
- **At-least-once delivery** with ack protocol and retry logic
- **HTTP callback fallback** when no WebSocket client is connected
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

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
