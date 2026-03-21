# hookr — Claude Code project context

Webhook relay for AI agents. Receives webhooks from providers (GitHub, Stripe, Slack), verifies signatures, and forwards events to local dev servers via WebSocket, HTTP polling, or HTTP callback.

## Quick reference

- **Language**: TypeScript (ES modules, Node >= 18)
- **Build**: `npm run build` (tsup)
- **Test**: `npm test` (vitest)
- **Lint**: `npm run lint` (prettier)
- **Start**: `npm start` or `hookr serve`

## Architecture

```
src/
  bin/hookr.ts          CLI entrypoint
  cli/                  Commander-based CLI (setup, listen, poll, channel)
  server/               Hono HTTP server + WebSocket
    verify.ts           Signature verification (GitHub, Stripe, Slack)
    delivery.ts         At-least-once delivery workers
    ws.ts               WebSocket subscription protocol
    routes/             HTTP routes (webhook receiver, REST API, health)
  db/                   SQLite via Drizzle ORM (channels, events tables)
  shared/               Types, WS protocol, constants
deploy/
  aws.sh                One-command AWS EC2 deploy
  digitalocean.sh       One-command DigitalOcean deploy
  cloud-init.sh         Server provisioning script
  manage.sh             Remote management (status, logs, backup, update, teardown)
```

## Skills

- `/deploy-hookr` — Autonomous end-to-end deployment: provisions cloud server, configures DNS, sets up webhook channels with signature verification, installs CLI, and verifies the full pipeline.
