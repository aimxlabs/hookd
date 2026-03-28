# hookd — Claude Code project context

HTTP trigger endpoint for AI agents. Receives payloads via simple HTTP POST and forwards events to agents via WebSocket, HTTP polling, or HTTP callback. Optionally verifies webhook signatures from known providers (GitHub, Stripe, Slack). Supports hello-message (Ethereum signature) authentication for channel ownership.

## Quick reference

- **Language**: TypeScript (ES modules, Node >= 18)
- **Build**: `npm run build` (tsup)
- **Test**: `npm test` (vitest)
- **Lint**: `npm run lint` (prettier)
- **Start**: `npm start` or `hookd serve`

## Architecture

```
src/
  bin/hookd.ts          CLI entrypoint
  cli/                  Commander-based CLI (setup, listen, poll, channel, manage, deploy)
  server/               Hono HTTP server + WebSocket
    verify.ts           Signature verification (GitHub, Stripe, Slack)
    delivery.ts         At-least-once delivery workers
    ws.ts               WebSocket subscription protocol
    routes/             HTTP routes (webhook receiver, REST API, health)
  db/                   SQLite via Drizzle ORM (channels, events tables)
  shared/               Types, WS protocol, constants
deploy/
  cloud-init.sh         Server provisioning script (runs on remote VM via cloud-init)
```

## Channel authentication

Two auth models for channels:

- **Token-based** (legacy): Admin creates channel via admin token, gets back a `tok_` channel token. Anyone with the token can read/poll/ack events. Token is shared, no per-agent identity.
- **Hello-message** (identity-based): Agent creates channel with `Authorization: Hello <base64>`. The channel is owned by the signer's Ethereum address (`owner_address` column). Only the owner can read/poll/ack events — they must prove ownership via hello-message on every request. No shared tokens. WebSocket auth also accepts hello-message tokens.

Webhook publishing (`POST /h/:channelId`) is always unauthenticated — anyone can push events to a channel if they know its ID.

## Skills

- `/deploy-hookd` — Autonomous end-to-end deployment: provisions cloud server, configures DNS, sets up webhook channels with signature verification, installs CLI, and verifies the full pipeline.
