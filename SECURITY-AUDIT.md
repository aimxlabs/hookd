# Security Audit Report — hookd

**Date**: 2026-03-21
**Scope**: Full codebase review (src/, deploy/, Docker, configuration)
**Version**: 0.1.0

---

## Executive Summary

hookd is a webhook relay for AI agents — it receives webhooks from providers (GitHub, Stripe, Slack), verifies signatures, and forwards events via WebSocket or HTTP callback. A comprehensive security audit was performed and all critical, high, and medium issues have been resolved.

---

## Resolved Issues

The following issues were identified and fixed:

### Critical (Fixed)

| # | Issue | Fix |
|---|-------|-----|
| 1 | WebSocket token comparison used `!==` (timing attack) | Use `timingSafeEqual` with length pre-check |
| 2 | Unknown providers bypassed signature verification (`default: return true`) | `default` returns `false`; explicit `"generic"` case added; provider validated on channel creation |

### High (Fixed)

| # | Issue | Fix |
|---|-------|-----|
| 3 | SSRF via callbackUrl — no validation of private IPs or metadata endpoints | Comprehensive validation: blocks private IPv4/IPv6, cloud metadata, loopback, CGN, `*.localhost` |
| 4 | Channel list/detail endpoints were unauthenticated (channel enumeration) | Require admin token for `GET /api/channels` and `GET /api/channels/:id` |

### Medium (Fixed)

| # | Issue | Fix |
|---|-------|-----|
| 5 | Channel create response leaked `secret` field | Explicit field selection; `secret` omitted from response |
| 6 | No WebSocket message size limit (memory exhaustion) | 4KB limit on client messages |
| 7 | Admin token echoed to cloud-init logs | Token written to `600`-permission file instead |
| 8 | Token accepted via `?token=` query parameter (logged by proxies) | Removed; tokens must use `Authorization: Bearer` header |

### Low (Fixed)

| # | Issue | Fix |
|---|-------|-----|
| 9 | `parseClientMessage` accepted any JSON shape | Validate required fields per message type |

---

## Remaining Recommendations

These are lower-priority items that may warrant attention as the project grows:

| # | Severity | Issue | Notes |
|---|----------|-------|-------|
| 1 | Medium | No rate limiting on any endpoint | Mitigate at reverse proxy layer (Caddy rate_limit plugin or WAF) |
| 2 | Low | No CORS configuration | API accessible from any origin; add CORS headers if browser clients are expected |
| 3 | Low | SSH `StrictHostKeyChecking=no` in deploy/manage.sh | Risk of MITM on server management connections |
| 4 | Low | Node 18 base image approaching EOL | Consider upgrading Dockerfile to Node 20 or 22 |

---

## What's Done Well

- Signature verification uses `timingSafeEqual` for constant-time HMAC comparison
- Stripe/Slack replay protection with 5-minute timestamp tolerance
- `nanoid` provides cryptographically secure ID generation (96 bits of entropy)
- Drizzle ORM prevents SQL injection via parameterized queries
- Docker container drops to non-root `node` user
- `dumb-init` handles PID 1 signal forwarding correctly
- Multi-stage Docker build minimizes runtime image size
- Graceful shutdown cleans up workers and database connections
- SQLite WAL mode enables safe concurrent access
- Config file permissions set to `0600` (owner-only)
- Header allowlist on HTTP callback delivery prevents header injection
- Callback URL validation blocks SSRF against private networks and cloud metadata
- Admin authentication required for all channel management endpoints
- WebSocket ack verifies channel subscription before marking events delivered
