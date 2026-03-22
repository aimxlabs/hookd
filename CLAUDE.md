# hookd — Claude Code project context

HTTP trigger endpoint for AI agents. Receives payloads via simple HTTP POST and forwards events to agents via WebSocket, HTTP polling, or HTTP callback. Optionally verifies webhook signatures from known providers (GitHub, Stripe, Slack).

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

## Skills

- `/deploy-hookd` — Autonomous end-to-end deployment: provisions cloud server, configures DNS, sets up webhook channels with signature verification, installs CLI, and verifies the full pipeline.
