import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { nanoid } from "nanoid";
import { createApp } from "../../src/server/index.js";
import { initMemoryDb, closeDb, getDb, schema } from "../../src/db/index.js";
import { CHANNEL_ID_PREFIX, TOKEN_PREFIX } from "../../src/shared/constants.js";

describe("webhook routes", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    initMemoryDb();
    const result = createApp();
    app = result.app;
  });

  afterEach(() => {
    closeDb();
  });

  function createChannel(overrides: Partial<typeof schema.channels.$inferInsert> = {}) {
    const db = getDb();
    const id = `${CHANNEL_ID_PREFIX}${nanoid(16)}`;
    db.insert(schema.channels)
      .values({
        id,
        name: "test",
        authToken: `${TOKEN_PREFIX}${nanoid(24)}`,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        ...overrides,
      })
      .run();
    return id;
  }

  it("receives a webhook and stores the event", async () => {
    const channelId = createChannel();
    const res = await app.request(`/h/${channelId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.eventId).toMatch(/^evt_/);

    // Verify event was stored
    const db = getDb();
    const events = db.select().from(schema.events).all();
    expect(events).toHaveLength(1);
    expect(events[0].channelId).toBe(channelId);
  });

  it("returns 404 for unknown channel", async () => {
    const res = await app.request("/h/ch_nonexistent", {
      method: "POST",
      body: "test",
    });
    expect(res.status).toBe(404);
  });

  it("rejects webhook with invalid signature", async () => {
    const channelId = createChannel({
      provider: "github",
      secret: "my-secret",
    });

    const res = await app.request(`/h/${channelId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "sha256=invalid",
      },
      body: JSON.stringify({ action: "push" }),
    });

    expect(res.status).toBe(401);
  });

  it("accepts webhook with valid github signature", async () => {
    const { createHmac } = await import("node:crypto");
    const secret = "my-secret";
    const body = JSON.stringify({ action: "push" });
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    const channelId = createChannel({ provider: "github", secret });

    const res = await app.request(`/h/${channelId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body,
    });

    expect(res.status).toBe(200);
  });
});

describe("API routes", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    initMemoryDb();
    const result = createApp();
    app = result.app;
  });

  afterEach(() => {
    closeDb();
  });

  it("creates a channel", async () => {
    const res = await app.request("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-channel" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toMatch(/^ch_/);
    expect(body.name).toBe("test-channel");
    expect(body.authToken).toMatch(/^tok_/);
  });

  it("lists channels", async () => {
    // Create a channel first
    await app.request("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    const res = await app.request("/api/channels");
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("test");
  });

  it("deletes a channel", async () => {
    const createRes = await app.request("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "to-delete" }),
    });
    const channel = await createRes.json() as any;

    const deleteRes = await app.request(`/api/channels/${channel.id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    const listRes = await app.request("/api/channels");
    const channels = await listRes.json() as any[];
    expect(channels).toHaveLength(0);
  });

  it("returns health status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
  });
});
