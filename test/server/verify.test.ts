import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyGithubSignature,
  verifyStripeSignature,
  verifySlackSignature,
  verifyWebhookSignature,
} from "../../src/server/verify.js";

describe("verifyGithubSignature", () => {
  const secret = "test-secret";
  const body = '{"action":"push"}';

  it("accepts valid signature", () => {
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyGithubSignature(body, secret, sig)).toBe(true);
  });

  it("rejects invalid signature", () => {
    expect(verifyGithubSignature(body, secret, "sha256=invalid")).toBe(false);
  });

  it("rejects missing signature", () => {
    expect(verifyGithubSignature(body, secret, undefined)).toBe(false);
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_123"}';

  it("accepts valid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = `${timestamp}.${body}`;
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    const header = `t=${timestamp},v1=${sig}`;
    expect(verifyStripeSignature(body, secret, header)).toBe(true);
  });

  it("rejects invalid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const header = `t=${timestamp},v1=invalidsig`;
    expect(verifyStripeSignature(body, secret, header)).toBe(false);
  });

  it("rejects missing header", () => {
    expect(verifyStripeSignature(body, secret, undefined)).toBe(false);
  });

  it("rejects replayed signature with old timestamp", () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 min ago
    const payload = `${oldTimestamp}.${body}`;
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    const header = `t=${oldTimestamp},v1=${sig}`;
    expect(verifyStripeSignature(body, secret, header)).toBe(false);
  });
});

describe("verifySlackSignature", () => {
  const secret = "slack-signing-secret";
  const body = "token=abc&text=hello";

  it("accepts valid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const baseString = `v0:${timestamp}:${body}`;
    const sig = `v0=${createHmac("sha256", secret).update(baseString).digest("hex")}`;
    expect(verifySlackSignature(body, secret, sig, timestamp)).toBe(true);
  });

  it("rejects invalid signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(body, secret, "v0=invalid", timestamp)).toBe(
      false,
    );
  });

  it("rejects replayed signature with old timestamp", () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 min ago
    const baseString = `v0:${oldTimestamp}:${body}`;
    const sig = `v0=${createHmac("sha256", secret).update(baseString).digest("hex")}`;
    expect(verifySlackSignature(body, secret, sig, oldTimestamp)).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  it("returns true for generic provider", () => {
    expect(verifyWebhookSignature("generic", "body", "secret", {})).toBe(true);
  });

  it("rejects unknown provider to prevent verification bypass", () => {
    expect(verifyWebhookSignature("unknown", "body", "secret", {})).toBe(false);
  });

  it("delegates to github verifier", () => {
    const body = "test";
    const secret = "s";
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(
      verifyWebhookSignature("github", body, secret, {
        "x-hub-signature-256": sig,
      }),
    ).toBe(true);
  });
});
