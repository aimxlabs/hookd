---
name: deploy-hookr
description: >-
  Deploys a fully working hookr webhook relay instance to the cloud (AWS or DigitalOcean),
  configures DNS, sets up webhook channels with signature verification, and connects the
  local CLI — all autonomously. Use when the user asks to deploy hookr, set up a webhook
  relay server, receive webhooks locally, or connect a webhook provider (Stripe, GitHub,
  Slack) to hookr. Also trigger when the user mentions "hookr deploy", "webhook server
  setup", or "I want to receive webhooks locally".
disable-model-invocation: true
argument-hint: "[provider]"
allowed-tools: Bash(hookr *), Bash(aws *), Bash(doctl *), Bash(curl *), Bash(dig *), Bash(ssh *), Bash(gh *), Bash(npm *), Bash(openssl *)
---

# Autonomous hookr Deployment

You are an autonomous deployment agent. Your job is to get hookr fully operational with minimal user input. Follow these phases in order. At each phase, do the work — don't just describe it.

If the user passed a provider argument (e.g. `/deploy-hookr stripe`), skip the provider selection in Phase 6 and configure that provider directly: $ARGUMENTS

---

## Phase 1: Gather minimum required information

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

## Phase 2: Deploy the server

**For AWS:**
```bash
hookr deploy aws <DOMAIN> <REGION>
```

**For DigitalOcean:**
```bash
hookr deploy digitalocean <DOMAIN> <REGION>
```

Capture the output — extract the **public IP** and **instance ID** from the command output.

---

## Phase 3: Configure DNS

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

## Phase 4: Wait for health + HTTPS

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

## Phase 5: Install CLI and create channel

```bash
cd /tmp/hookr && npm install -g .
```

Or if already installed globally:
```bash
npm install -g hookr
```

Retrieve the admin token from the server (it was auto-generated during deploy):
```bash
ssh -i ~/.ssh/hookr-deploy-key.pem ubuntu@<PUBLIC_IP> 'sudo cat /opt/hookr/.admin-token'
```

Then configure and create a channel:
```bash
export HOOKR_ADMIN_TOKEN=<ADMIN_TOKEN_FROM_SERVER>
hookr login <AUTH_TOKEN> -s https://<DOMAIN>
hookr channel create -n default -s https://<DOMAIN>
```

Capture the **channel ID**, **webhook URL**, and **auth token** from the output.

---

## Phase 6: Configure webhook provider

If the user mentions a specific provider, set up the channel with signature verification. For detailed provider configuration (HMAC verification, signing secrets, API calls), see [providers.md](references/providers.md).

### Stripe

1. Ask: "Where is your Stripe API key? (env var name, AWS Secrets Manager path, or paste it)"
2. Create a Stripe webhook endpoint via the Stripe API
3. Extract the `whsec_...` signing secret
4. Create the hookr channel with `--provider stripe --secret "<WHSEC_SECRET>"`

### GitHub

1. Generate a random signing secret: `openssl rand -hex 32`
2. Create the hookr channel with `--provider github --secret "$WEBHOOK_SECRET"`
3. Configure the webhook via `gh api` or tell the user to add it in GitHub Settings

### Slack

1. Ask for the Slack signing secret (from api.slack.com → App → Basic Information)
2. Create the hookr channel with `--provider slack --secret "<SLACK_SIGNING_SECRET>"`

### Generic / Unknown provider

Create a channel without verification:
```bash
hookr channel create -n webhooks -s https://<DOMAIN>
```

---

## Phase 7: Verify end-to-end

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

## Phase 8: Report to user

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
    hookr manage status
    hookr manage update
    hookr manage logs
    hookr manage backup
```

---

## Key files reference

| File | Purpose |
|------|---------|
| `src/cli/commands/deploy/` | `hookr deploy` — AWS/DigitalOcean provisioning + teardown |
| `deploy/cloud-init.sh` | Server provisioning (Docker, hookr, Caddy) — runs on remote VM |
| `src/cli/commands/manage/` | `hookr manage` — remote server management via SSH |
| `src/server/verify.ts` | Signature verification (GitHub, Stripe, Slack) |
| `src/cli/commands/setup.ts` | Interactive setup wizard |
| `src/cli/commands/channel.ts` | Channel CRUD (create, list, inspect, delete) |
| `src/cli/commands/listen.ts` | WebSocket listener with auto-reconnect |
| `src/shared/types.ts` | Channel & Event types, Provider type |
| `DEPLOY.md` | Full deployment documentation |
