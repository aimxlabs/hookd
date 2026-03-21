# /deploy-hookr — Autonomous hookr deployment skill

## Description

Deploys a fully working hookr instance to the cloud, configures DNS, sets up webhook channels with signature verification, and connects the local CLI — all autonomously. The AI asks the user only what it cannot determine on its own (domain name, secret locations).

## When to use

Use this skill when the user asks to:
- Deploy hookr / set up hookr / get hookr running
- Set up a webhook relay server
- "I want to receive webhooks locally"
- Connect a webhook provider (Stripe, GitHub, Slack) to hookr

## Instructions

You are an autonomous deployment agent. Your job is to get hookr fully operational with minimal user input. Follow these phases in order. At each phase, do the work — don't just describe it.

---

### Phase 1: Gather minimum required information

Ask the user only what you cannot determine yourself:

1. **Domain**: "What domain should hookr use? (e.g. `hookr.yourdomain.com`)"
2. **Cloud provider**: Check which credentials are available in the environment:
   - Run `aws sts get-caller-identity` to detect AWS
   - Run `doctl account get` to detect DigitalOcean
   - If both or neither are available, ask the user which to use

Do NOT ask about:
- Region (default to `us-east-1` for AWS, `nyc1` for DO)
- Instance size (default to `t3.small` / `s-1vcpu-1gb`)
- Any other configuration — use sensible defaults

---

### Phase 2: Clone and deploy the server

```bash
# Clone the repo if not already present
git clone https://github.com/aimxlabs/hookr.git /tmp/hookr 2>/dev/null || true
cd /tmp/hookr
```

**For AWS:**
```bash
./deploy/aws.sh <DOMAIN> <REGION>
```

**For DigitalOcean:**
```bash
./deploy/digitalocean.sh <DOMAIN>
```

Capture the output — extract the **public IP** and **instance ID** from the script output.

---

### Phase 3: Configure DNS

Check if you can manage DNS programmatically:

**AWS Route 53:**
```bash
# Extract the base domain from the full domain (e.g. acmecorp.com from hookr.acmecorp.com)
BASE_DOMAIN=$(echo "<DOMAIN>" | awk -F. '{print $(NF-1)"."$NF}')

# Find the hosted zone
ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name "$BASE_DOMAIN" \
  --query "HostedZones[0].Id" \
  --output text | sed 's|/hostedzone/||')

# Create the A record
aws route53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID" \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "<DOMAIN>",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "<PUBLIC_IP>"}]
      }
    }]
  }'
```

**If DNS cannot be managed programmatically**, tell the user:
> Point your DNS A record for `<DOMAIN>` to `<PUBLIC_IP>`, then tell me when it's done.

Wait for DNS propagation:
```bash
dig <DOMAIN> +short  # Should return the public IP
```

---

### Phase 4: Wait for health + HTTPS

```bash
# Poll until the server is healthy (up to 5 minutes)
for i in $(seq 1 60); do
  curl -sf "http://<PUBLIC_IP>/health" -H "Host: <DOMAIN>" && break
  sleep 5
done

# Then wait for HTTPS (Let's Encrypt via Caddy)
for i in $(seq 1 30); do
  curl -sf "https://<DOMAIN>/health" && break
  sleep 10
done
```

If health checks time out, SSH in and check logs:
```bash
ssh -i ~/.ssh/hookr-deploy-key.pem ubuntu@<PUBLIC_IP> 'tail -50 /var/log/cloud-init-output.log'
```

---

### Phase 5: Install CLI and create channel

```bash
cd /tmp/hookr && npm install -g .
```

Or if already installed globally:
```bash
npm install -g hookr
```

Then configure and create a channel:
```bash
hookr login <AUTH_TOKEN> -s https://<DOMAIN>
hookr channel create -n default -s https://<DOMAIN>
```

Capture the **channel ID** and **webhook URL** from the output.

---

### Phase 6: Configure webhook provider (if specified)

If the user mentions a specific provider, set up the channel with signature verification.

#### Stripe

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
5. Create the hookr channel with verification:
```bash
hookr channel create \
  -n stripe-webhooks \
  --provider stripe \
  --secret "<WHSEC_SECRET>" \
  -s https://<DOMAIN>
```

**How Stripe verification works** (explain to user):
- Stripe signs every webhook with HMAC-SHA256 using the signing secret
- The signature and timestamp are in the `Stripe-Signature` header: `t=<timestamp>,v1=<signature>`
- hookr reconstructs the expected signature: `HMAC_SHA256(key=whsec_..., data="{timestamp}.{body}")`
- If signatures don't match → 401 rejected
- hookr uses timing-safe comparison to prevent timing attacks

#### GitHub

1. Generate a random signing secret:
```bash
WEBHOOK_SECRET=$(openssl rand -hex 32)
```
2. Create the hookr channel with verification:
```bash
hookr channel create \
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

**How GitHub verification works** (explain to user):
- GitHub signs the payload with HMAC-SHA256 using the shared secret
- The signature is in the `X-Hub-Signature-256` header: `sha256=<hex_digest>`
- hookr computes `HMAC_SHA256(key=secret, data=raw_body)` and compares

#### Slack

1. Ask for the Slack signing secret (from api.slack.com → App → Basic Information)
2. Create the hookr channel:
```bash
hookr channel create \
  -n slack-events \
  --provider slack \
  --secret "<SLACK_SIGNING_SECRET>" \
  -s https://<DOMAIN>
```

**How Slack verification works** (explain to user):
- Slack sends `X-Slack-Signature` and `X-Slack-Request-Timestamp` headers
- hookr constructs `v0:{timestamp}:{body}` and computes `HMAC_SHA256(key=secret, data=baseString)`
- Expected format: `v0=<hex_digest>`

#### Generic / Unknown provider

Create a channel without verification:
```bash
hookr channel create -n webhooks -s https://<DOMAIN>
```

---

### Phase 7: Verify end-to-end

Send a test webhook to confirm the full pipeline works:

```bash
# Start listener in background
hookr listen <CHANNEL_ID> --target http://localhost:3000 --json &
LISTENER_PID=$!

# Send a test event
curl -X POST "https://<DOMAIN>/h/<CHANNEL_ID>" \
  -H "Content-Type: application/json" \
  -d '{"test": true, "source": "deploy-hookr-skill"}'

# Kill listener
kill $LISTENER_PID 2>/dev/null
```

Also test that **forged webhooks are rejected** (if verification is enabled):
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "https://<DOMAIN>/h/<CHANNEL_ID>" \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=0,v1=invalid" \
  -d '{"forged": true}'
# Should return 401
```

---

### Phase 8: Report to user

Present a clear summary:

```
hookr is deployed and ready.

  Server:       https://<DOMAIN>
  Health:       https://<DOMAIN>/health
  Webhook URL:  https://<DOMAIN>/h/<CHANNEL_ID>
  Instance:     <INSTANCE_ID> (<REGION>)
  IP:           <PUBLIC_IP>
  SSH:          ssh -i ~/.ssh/hookr-deploy-key.pem ubuntu@<PUBLIC_IP>

  Verification: <PROVIDER> (HMAC-SHA256) — forged webhooks rejected
  Signing secret stored in: <LOCATION>

  Listen locally:
    hookr listen <CHANNEL_ID> --target http://localhost:8080/webhook

  Management:
    ./deploy/manage.sh status  --host <PUBLIC_IP>
    ./deploy/manage.sh update  --host <PUBLIC_IP>
    ./deploy/manage.sh logs    --host <PUBLIC_IP>
    ./deploy/manage.sh backup  --host <PUBLIC_IP>
```

---

## Key files reference

| File | Purpose |
|------|---------|
| `deploy/aws.sh` | One-command AWS EC2 deployment |
| `deploy/digitalocean.sh` | One-command DigitalOcean deployment |
| `deploy/cloud-init.sh` | Server provisioning (Docker, hookr, Caddy) |
| `deploy/manage.sh` | Remote server management (status, logs, backup, update, teardown) |
| `src/server/verify.ts` | Signature verification (GitHub, Stripe, Slack) |
| `src/cli/commands/setup.ts` | Interactive setup wizard |
| `src/cli/commands/channel.ts` | Channel CRUD (create, list, inspect, delete) |
| `src/cli/commands/listen.ts` | WebSocket listener with auto-reconnect |
| `src/shared/types.ts` | Channel & Event types, Provider type |
| `DEPLOY.md` | Full deployment documentation |

## Supported providers and their verification

| Provider | Header | Algorithm | Secret format |
|----------|--------|-----------|---------------|
| `github` | `X-Hub-Signature-256` | HMAC-SHA256 of raw body | Any string (you generate it) |
| `stripe` | `Stripe-Signature` | HMAC-SHA256 of `{timestamp}.{body}` | `whsec_...` (Stripe provides it) |
| `slack` | `X-Slack-Signature` + `X-Slack-Request-Timestamp` | HMAC-SHA256 of `v0:{timestamp}:{body}` | From Slack app settings |
| `generic` | None | No verification | N/A |

## Error recovery

- **Deploy script fails**: Check AWS/DO credentials, try `aws sts get-caller-identity`
- **Health check times out**: SSH in, check `tail -f /var/log/cloud-init-output.log`
- **HTTPS not working**: Verify DNS with `dig <DOMAIN>`, check Caddy logs via `./deploy/manage.sh logs --host <IP> caddy`
- **Webhook verification fails**: Ensure the signing secret matches exactly what the provider expects
- **WebSocket disconnects**: The listener auto-reconnects with exponential backoff + jitter
