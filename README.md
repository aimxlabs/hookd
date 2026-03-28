# hookd

HTTP trigger endpoint for AI agents. Send a POST to a public URL, your agent gets it instantly.

AI agents run on laptops, behind firewalls, inside containers — they can't receive inbound HTTP requests from the outside world. **hookd** gives every agent an externally-accessible URL. Anything that can make an HTTP POST can trigger your agent in real-time.

## Why hookd?

We're in the middle of a personal AI agent revolution. People are spinning up custom software with a few prompts — apps, bots, workflows, internal tools — and those creations need a way to talk back to the agents that built them, or to other agents.

The missing piece isn't webhook processing from Stripe or GitHub. Those providers are building their own native agent integrations. **The gap is simpler and more fundamental: there's no easy way to send a payload to an agent.**

Your agent has no stable address. It's running on your MacBook, behind your home router, inside a Docker container on a dev server. There's no URL the outside world can POST to.

**hookd solves this in one line:**

```bash
curl -X POST https://hookd.example.com/h/ch_abc123 \
  -H "Content-Type: application/json" \
  -d '{"event": "deploy_complete", "status": "success"}'
```

Your agent receives that payload instantly via WebSocket. No tunnels to configure, no ports to open, no infrastructure to manage beyond a single lightweight relay server.

**This matters because:**

- **Agent-to-agent communication** — Your code-generation agent finishes a build and needs to notify your deployment agent. POST to its hookd channel.
- **App-to-agent triggers** — The app you built with Claude needs to wake your monitoring agent when something goes wrong. POST to its hookd channel.
- **Any external system** — CI/CD pipelines, IoT devices, cron jobs, third-party APIs — anything that can make an HTTP request can trigger your agent.
- **Vibe-coded software** — When someone builds an app in 10 minutes with AI, they're not going to set up ngrok and configure webhook signatures. They need a URL they can POST to.

hookd also supports signature verification for GitHub, Stripe, and Slack webhooks if you need it — but the core value is the generic trigger. Deploy once, create channels, POST anything.

## Quick Start

The fastest way to get hookd running is with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and the built-in `/deploy-hookd` skill. It handles everything end-to-end — server provisioning, DNS, HTTPS, and channel creation.

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
- Install the CLI and create a trigger channel
- Verify the full pipeline end-to-end and report a summary

Once deployed, forward events to your local agent:

```bash
hookd listen <channel-id> --target http://localhost:3000
```

## How It Works

1. Create a **channel** — get a unique trigger URL (`https://hookd.example.com/h/ch_...`)
2. **POST any payload** to that URL from anywhere — your app, another agent, a CI pipeline, a curl command
3. Your agent receives the event instantly via one of three delivery modes:
   - **`hookd listen`** — real-time WebSocket push (persistent connection)
   - **`hookd poll`** — HTTP polling (cron-friendly, no persistent connection)
   - **HTTP callback** — hookd POSTs to a URL you configure
4. Events are stored for replay and retry if delivery fails

Optionally, if the sender is a known webhook provider (GitHub, Stripe, Slack), hookd can verify signatures before forwarding.

## Features

- **Real-time delivery** via WebSocket with automatic reconnection
- **At-least-once delivery** with ack protocol and retry logic
- **Event storage** in SQLite for replay and debugging
- **HTTP callback fallback** when no WebSocket client is connected
- **HTTP polling** for cron-based agents that can't maintain connections
- **Self-hosted** — single binary, zero external dependencies
- **Signature verification** for GitHub (HMAC-SHA256), Stripe, and Slack webhooks

## Commands

```
hookd setup                    Guided setup — connect to server, create channel
hookd listen <channelId>       Forward events to a local URL via WebSocket
hookd poll <channelId>         Poll for pending events (cron-friendly)
hookd channel create           Create a new channel
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

### Triggering Your Agent (Generic Pattern)

The simplest integration — POST a JSON payload and your agent receives it:

```bash
# From anywhere: your app, a script, another agent, CI/CD
curl -X POST https://hookd.example.com/h/<channel-id> \
  -H "Content-Type: application/json" \
  -d '{"event": "user_signup", "user_id": "u_123", "email": "alice@example.com"}'
```

On your local machine, your agent is listening:

```bash
hookd listen <channel-id> --target http://localhost:3000/events
```

Your agent's `/events` endpoint receives the full payload with original headers. Custom headers are forwarded through — use them for routing, correlation IDs, or anything else your agent needs.

| Mode | Command | Best for |
|------|---------|----------|
| WebSocket | `hookd listen` | Real-time agents with persistent connections |
| HTTP poll | `hookd poll` | Cron jobs, serverless, ephemeral agents |
| HTTP callback | `--callback-url` | Agents with their own HTTP server |

### OpenClaw (Clawdbot)

The [Quick Start](#quick-start) above covers the full deployment workflow. Once hookd is running, forward events to OpenClaw's Gateway:

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

**Cron-based polling** — if you can't keep a persistent WebSocket connection:

```bash
*/1 * * * * hookd poll <channel-id> --target http://127.0.0.1:18789/hooks/wake
```

### Webhook Providers (GitHub, Stripe, Slack)

If you need to receive verified webhooks from a known provider, hookd supports that too. During `hookd setup`, choose the provider and enter your signing secret. hookd will verify every payload before forwarding it to your agent.

See the `/deploy-hookd` skill for fully automated provider setup.

**Programmatic usage:**

```typescript
import { createApp, startServer } from "hookd";

// Start hookd as part of your agent
await startServer({ port: 4801, dbPath: "hookd.db" });

// Or mount the Hono app inside your own server
const { app, injectWebSocket } = createApp();
```

**WebSocket client (token auth):**

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
    handleEvent(msg.body, msg.headers);
    ws.send(JSON.stringify({ type: "ack", eventId: msg.eventId }));
  }
});
```

**WebSocket client (hello-message auth):**

```typescript
// For identity-owned channels, pass a hello-message as the auth token
ws.on("open", () => {
  const helloMsg = generateHelloMessage(privateKey); // base64-encoded signed message
  ws.send(JSON.stringify({ type: "auth", token: helloMsg }));
  ws.send(JSON.stringify({ type: "subscribe", channelId: "ch_..." }));
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
POST   /api/channels              Create a channel           (admin token or hello-message)
GET    /api/channels              List channels              (admin token)
GET    /api/channels/:id          Get channel details        (admin token)
DELETE /api/channels/:id          Delete a channel           (admin token)
GET    /api/channels/:id/events   Recent events              (channel token or hello-message)
GET    /api/channels/:id/poll     Poll for undelivered events (channel token or hello-message)
POST   /api/channels/:id/ack     Acknowledge polled events   (channel token or hello-message)

POST   /h/:channelId             Trigger endpoint (POST any payload here)
GET    /ws                       WebSocket endpoint for agents
GET    /health                   Health check
```

**Authentication:** Two models:

- **Token-based** (legacy): Admin creates channels with `HOOKD_ADMIN_TOKEN` (`Authorization: Bearer <token>`). Event access uses the channel's auth token (returned on creation).
- **Hello-message** (identity-based): Agents create channels with `Authorization: Hello <base64>` (Ethereum signature). The channel is owned by the signer's address. Only the owner can read/poll/ack events — they must prove ownership via hello-message on every request. No shared tokens needed.

### WebSocket Protocol

```jsonc
// Client sends (token auth)
{ "type": "auth", "token": "tok_..." }
// Client sends (hello-message auth — for identity-owned channels)
{ "type": "auth", "token": "eyJtZXNzYWdlIjoi..." }
// Then subscribe and ack as usual
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
