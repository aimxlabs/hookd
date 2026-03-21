import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGithubSignature(
  body: string,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  if (expected.length !== signatureHeader.length) return false;

  return timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader),
  );
}

export function verifyStripeSignature(
  body: string,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;

  // Stripe signature format: t=timestamp,v1=signature
  const parts = signatureHeader.split(",");
  const timestamp = parts
    .find((p) => p.startsWith("t="))
    ?.slice(2);
  const signature = parts
    .find((p) => p.startsWith("v1="))
    ?.slice(3);

  if (!timestamp || !signature) return false;

  const payload = `${timestamp}.${body}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  if (expected.length !== signature.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function verifySlackSignature(
  body: string,
  secret: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
): boolean {
  if (!signatureHeader || !timestampHeader) return false;

  const baseString = `v0:${timestampHeader}:${body}`;
  const expected = `v0=${createHmac("sha256", secret).update(baseString).digest("hex")}`;

  if (expected.length !== signatureHeader.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

export function verifyWebhookSignature(
  provider: string,
  body: string,
  secret: string,
  headers: Record<string, string>,
): boolean {
  switch (provider) {
    case "github":
      return verifyGithubSignature(
        body,
        secret,
        headers["x-hub-signature-256"],
      );
    case "stripe":
      return verifyStripeSignature(body, secret, headers["stripe-signature"]);
    case "slack":
      return verifySlackSignature(
        body,
        secret,
        headers["x-slack-signature"],
        headers["x-slack-request-timestamp"],
      );
    default:
      return true; // generic provider — no verification
  }
}
