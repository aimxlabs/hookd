# Security Audit Report — hookr

**Date**: 2026-03-21
**Scope**: Full codebase review (src/, deploy/, Docker, configuration)
**Version**: 0.1.0

---

## Executive Summary

hookr is a webhook relay for AI agents — it receives webhooks from providers (GitHub, Stripe, Slack), verifies signatures, and forwards events via WebSocket or HTTP callback. The codebase is clean and well-structured, but has several security gaps that must be addressed before production deployment.

**Critical**: 3 | **High**: 4 | **Medium**: 5 | **Low**: 4

---

## Critical Issues

### 1. Auth token and secret leaked via GET /api/channels/:id

**File**: `src/server/routes/api.ts:72-82`
**Impact**: Full channel takeover

The channel detail endpoint returns the complete channel object — including `authToken` and `secret` — with no authentication. Anyone who knows (or guesses) a channel ID can steal the token and impersonate the channel owner, or obtain the webhook signing secret.

The list endpoint (`GET /api/channels` line 54) correctly uses column projection to exclude sensitive fields. The detail endpoint does not.

**Fix**: Apply the same column projection, or require Bearer token authentication.

### 2. No replay protection for Stripe and Slack signatures

**File**: `src/server/verify.ts:20-60`
**Impact**: Signature verification bypass via replay

Both `verifyStripeSignature` and `verifySlackSignature` parse the timestamp from headers but never validate its age. An attacker who captures a valid signed webhook can replay it indefinitely.

**Fix**: Add timestamp validation with a ±5-minute tolerance:
```typescript
const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
if (age > 300) return false;
```

### 3. Channel creation and deletion require no authentication

**File**: `src/server/routes/api.ts:14, 85`
**Impact**: Unauthorized channel manipulation

`POST /api/channels` and `DELETE /api/channels/:id` are completely open. If the server is network-accessible, anyone can create channels or delete existing ones (delete cascades to all events via `ON DELETE CASCADE`).

**Fix**: Add admin authentication, or bind these endpoints to localhost only.

---

## High Issues

### 4. No request body size limits

**File**: `src/server/routes/webhook.ts:27`
**Impact**: Denial of service (memory/disk exhaustion)

`c.req.text()` reads the entire body with no size cap. Payloads are stored in SQLite. Large payloads exhaust memory and fill the database.

**Fix**: Add body size limit middleware (e.g., 1MB default).

### 5. No rate limiting

**Impact**: DoS, brute-force

No rate limiting on any endpoint. Unlimited webhook ingestion can fill the database. Token brute-force attempts against poll/ack endpoints are unrestricted.

**Fix**: Add per-IP rate limiting middleware.

### 6. SSRF via callbackUrl

**File**: `src/server/delivery.ts:49`
**Impact**: Internal network scanning, cloud metadata theft

The `callbackUrl` is user-provided at channel creation (no validation) and used directly in `fetch()`. An attacker can set it to internal addresses (`http://169.254.169.254/latest/meta-data/`, `http://localhost:xxxx`, etc.).

**Fix**: Validate callbackUrl — reject private/reserved IPs, metadata endpoints, and non-HTTP(S) schemes.

### 7. Header injection in HTTP callback delivery

**File**: `src/server/delivery.ts:51-55`
**Impact**: Request smuggling, auth bypass on callback targets

Original webhook headers are spread directly into the outgoing fetch request via `...event.headers`. Malicious webhook senders can inject `Authorization`, `Host`, `Cookie`, or other sensitive headers into the callback.

**Fix**: Allowlist specific headers to forward, or strip known-dangerous ones.

---

## Medium Issues

### 8. WebSocket ack has no channel authorization

**File**: `src/server/ws.ts:108-114`
**Impact**: Cross-channel event manipulation

`handleAck` marks events as delivered based only on `eventId`, with no check that the connection is authorized for that event's channel.

### 9. Token comparison is not constant-time

**Files**: `src/server/routes/api.ts:137`, `src/server/ws.ts:92`
**Impact**: Timing side-channel

Auth token checks use `!==` (standard string comparison). Signature verification correctly uses `timingSafeEqual`, but token authentication does not.

### 10. No input validation on WebSocket messages

**File**: `src/shared/protocol.ts:70-78`
**Impact**: Type confusion

`parseClientMessage` casts raw JSON to `ClientMessage` after only checking that `type` is a string. No field-level validation. Unexpected shapes could cause runtime errors or bypass logic.

### 11. Config file created with default permissions

**File**: `src/cli/config.ts:24-25`
**Impact**: Token exposure to other local users

`writeFileSync` creates `~/.hookr/config.json` with default permissions (typically 0644). Tokens are stored in plaintext. Should use 0600.

### 12. SSH StrictHostKeyChecking disabled in deploy scripts

**File**: `deploy/manage.sh:75`
**Impact**: MITM attacks on server management

All SSH connections use `-o StrictHostKeyChecking=no`.

---

## Low Issues

### 13. Events endpoint has no authentication

**File**: `src/server/routes/api.ts:103-116`

`GET /api/channels/:id/events` returns all events including full webhook bodies with no auth.

### 14. No upper bound on limit parameter

**Files**: `src/server/routes/api.ts:105, 122`

`?limit=999999999` could load the entire events table into memory.

### 15. No CORS configuration

No CORS headers configured. Cross-origin requests may be accepted.

### 16. Node 18 base image approaching EOL

**File**: `Dockerfile:2, 17`

Node 18 LTS is past its end-of-life (April 2025). Should upgrade to Node 20 or 22.

---

## What's Done Well

- Signature verification uses `timingSafeEqual` for constant-time comparison
- `nanoid` provides cryptographically secure ID generation
- Drizzle ORM prevents SQL injection via parameterized queries
- Docker container drops to non-root `node` user
- `dumb-init` handles PID 1 signal forwarding correctly
- Multi-stage Docker build minimizes runtime image size
- Graceful shutdown cleans up workers and database connections
- SQLite WAL mode enables safe concurrent access
- Channel list endpoint correctly projects columns to exclude secrets

---

## Recommended Fix Priority

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | Strip sensitive fields from channel detail endpoint | Trivial |
| 2 | Add timestamp validation to Stripe/Slack verification | Small |
| 3 | Add auth to channel creation/deletion | Medium |
| 4 | Validate callbackUrl (block private IPs) | Medium |
| 5 | Add body size limit middleware | Small |
| 6 | Sanitize forwarded headers in callback delivery | Small |
| 7 | Add auth check to WebSocket ack | Small |
| 8 | Use timingSafeEqual for token comparison | Trivial |
| 9 | Add rate limiting | Medium |
| 10 | Restrict config file permissions | Trivial |
