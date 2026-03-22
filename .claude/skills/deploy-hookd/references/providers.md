# Provider Verification Reference

Detailed provider configuration for hookd webhook channels. Read this when setting up a specific provider in Phase 6.

## Stripe

### Full setup steps

1. Ask: "Where is your Stripe API key? (env var name, AWS Secrets Manager path, or paste it)"
2. Retrieve the key
3. Create a Stripe webhook endpoint via the Stripe API:
```bash
curl -s https://api.stripe.com/v1/webhook_endpoints \
  -u "<STRIPE_API_KEY>:" \
  -d "url=https://<DOMAIN>/h/<CHANNEL_ID>" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=invoice.payment_failed" \
  -d "enabled_events[]=customer.subscription.deleted"
```
4. Extract the `secret` field (the `whsec_...` signing secret) from the response
5. Create the hookd channel with verification:
```bash
hookd channel create \
  -n stripe-webhooks \
  --provider stripe \
  --secret "<WHSEC_SECRET>" \
  -s https://<DOMAIN>
```

### How Stripe verification works

- Stripe signs every webhook with HMAC-SHA256 using the signing secret
- The signature and timestamp are in the `Stripe-Signature` header: `t=<timestamp>,v1=<signature>`
- hookd reconstructs the expected signature: `HMAC_SHA256(key=whsec_..., data="{timestamp}.{body}")`
- If signatures don't match → 401 rejected
- hookd uses timing-safe comparison to prevent timing attacks

## GitHub

### Full setup steps

1. Generate a random signing secret:
```bash
WEBHOOK_SECRET=$(openssl rand -hex 32)
```
2. Create the hookd channel with verification:
```bash
hookd channel create \
  -n github-webhooks \
  --provider github \
  --secret "$WEBHOOK_SECRET" \
  -s https://<DOMAIN>
```
3. Configure the GitHub webhook (if `gh` CLI is available):
```bash
gh api repos/<OWNER>/<REPO>/hooks -f url="https://<DOMAIN>/h/<CHANNEL_ID>" \
  -f content_type=json -f secret="$WEBHOOK_SECRET"
```
4. Or tell the user to add it manually in GitHub repo → Settings → Webhooks

### How GitHub verification works

- GitHub signs the payload with HMAC-SHA256 using the shared secret
- The signature is in the `X-Hub-Signature-256` header: `sha256=<hex_digest>`
- hookd computes `HMAC_SHA256(key=secret, data=raw_body)` and compares

## Slack

### Full setup steps

1. Ask for the Slack signing secret (from api.slack.com → App → Basic Information)
2. Create the hookd channel:
```bash
hookd channel create \
  -n slack-events \
  --provider slack \
  --secret "<SLACK_SIGNING_SECRET>" \
  -s https://<DOMAIN>
```

### How Slack verification works

- Slack sends `X-Slack-Signature` and `X-Slack-Request-Timestamp` headers
- hookd constructs `v0:{timestamp}:{body}` and computes `HMAC_SHA256(key=secret, data=baseString)`
- Expected format: `v0=<hex_digest>`

## Provider summary

| Provider | Header | Algorithm | Secret format |
|----------|--------|-----------|---------------|
| `github` | `X-Hub-Signature-256` | HMAC-SHA256 of raw body | Any string (you generate it) |
| `stripe` | `Stripe-Signature` | HMAC-SHA256 of `{timestamp}.{body}` | `whsec_...` (Stripe provides it) |
| `slack` | `X-Slack-Signature` + `X-Slack-Request-Timestamp` | HMAC-SHA256 of `v0:{timestamp}:{body}` | From Slack app settings |
| `generic` | None | No verification | N/A |

## Security model

hookd has two levels of authentication:

| Token | Env var / flag | Used for | Scope |
|-------|---------------|----------|-------|
| **Admin token** | `HOOKD_ADMIN_TOKEN` / `--admin-token` | Channel create, delete | Server-wide |
| **Channel token** | `HOOKD_TOKEN` / `--token` | Listen, poll, ack, inspect events | Per-channel |

- If `HOOKD_ADMIN_TOKEN` is not set on the server, channel management endpoints are unrestricted (safe for local dev).
- Webhook providers (GitHub, Stripe, Slack) authenticate via HMAC signature verification — they don't use either token.
- Webhook payloads are limited to 1 MB.
- Callback URLs are validated to prevent SSRF (private IPs and metadata endpoints are blocked).
- Stripe and Slack signatures include replay protection (5-minute timestamp window).

## Error recovery

- **Deploy command fails**: Check AWS/DO credentials, try `aws sts get-caller-identity`
- **Health check times out**: SSH in, check `tail -f /var/log/cloud-init-output.log`
- **HTTPS not working**: Verify DNS with `dig <DOMAIN>`, check Caddy logs via `hookd manage logs --service caddy --no-follow`
- **Webhook verification fails**: Ensure the signing secret matches exactly what the provider expects
- **WebSocket disconnects**: The listener auto-reconnects with exponential backoff + jitter
