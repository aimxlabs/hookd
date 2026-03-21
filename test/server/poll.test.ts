import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { nanoid } from "nanoid";
import { createApp } from "../../src/server/index.js";
import { initMemoryDb, closeDb, getDb, schema } from "../../src/db/index.js";
import {
  CHANNEL_ID_PREFIX,
  TOKEN_PREFIX,
  EVENT_ID_PREFIX,
} from "../../src/shared/constants.js";

describe("poll endpoint", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    initMemoryDb();
    const result = createApp();
    app = result.app;
  });

  afterEach(() => {
    closeDb();
  });

  function createChannel(
    overrides: Partial<typeof schema.channels.$inferInsert> = {},
  ) {
    const db = getDb();
    const id = `${CHANNEL_ID_PREFIX}${nanoid(16)}`;
    const authToken = `${TOKEN_PREFIX}${nanoid(24)}`;
    db.insert(schema.channels)
      .values({
        id,
        name: "test",
        authToken,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        ...overrides,
      })
      .run();
    return { id, authToken };
  }

  function insertEvent(
    channelId: string,
    overrides: Partial<typeof schema.events.$inferInsert> = {},
  ) {
    const db = getDb();
    const id = `${EVENT_ID_PREFIX}${nanoid(16)}`;
    db.insert(schema.events)
      .values({
        id,
        channelId,
        headers: JSON.stringify({ "content-type": "application/json" }),
        body: JSON.stringify({ test: true }),
        method: "POST",
        sourceIp: "127.0.0.1",
        receivedAt: Math.floor(Date.now() / 1000),
        attempts: 0,
        ...overrides,
      })
      .run();
    return id;
  }

  it("returns undelivered events", async () => {
    const { id: channelId, authToken } = createChannel();
    const evtId = insertEvent(channelId);

    const res = await app.request(
      `/api/channels/${channelId}/poll`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe(evtId);
    expect(body.cursor).toBe(evtId);
  });

  it("excludes already-delivered events", async () => {
    const { id: channelId, authToken } = createChannel();
    insertEvent(channelId, {
      deliveredAt: Math.floor(Date.now() / 1000),
    });

    const res = await app.request(
      `/api/channels/${channelId}/poll`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.events).toHaveLength(0);
    expect(body.cursor).toBeNull();
  });

  it("requires auth token", async () => {
    const { id: channelId } = createChannel();

    const res = await app.request(`/api/channels/${channelId}/poll`);
    expect(res.status).toBe(401);
  });

  it("rejects wrong token", async () => {
    const { id: channelId } = createChannel();

    const res = await app.request(
      `/api/channels/${channelId}/poll`,
      { headers: { Authorization: "Bearer tok_wrong" } },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown channel", async () => {
    const res = await app.request(
      "/api/channels/ch_nonexistent/poll",
      { headers: { Authorization: "Bearer tok_anything" } },
    );
    expect(res.status).toBe(404);
  });

  it("respects limit parameter", async () => {
    const { id: channelId, authToken } = createChannel();
    const now = Math.floor(Date.now() / 1000);
    insertEvent(channelId, { receivedAt: now - 2 });
    insertEvent(channelId, { receivedAt: now - 1 });
    insertEvent(channelId, { receivedAt: now });

    const res = await app.request(
      `/api/channels/${channelId}/poll?limit=2`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );

    const body = (await res.json()) as any;
    expect(body.events).toHaveLength(2);
  });

  it("supports cursor-based pagination with after param", async () => {
    const { id: channelId, authToken } = createChannel();
    const now = Math.floor(Date.now() / 1000);
    const evt1 = insertEvent(channelId, { receivedAt: now - 2 });
    const evt2 = insertEvent(channelId, { receivedAt: now - 1 });
    const evt3 = insertEvent(channelId, { receivedAt: now });

    const res = await app.request(
      `/api/channels/${channelId}/poll?after=${evt1}`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );

    const body = (await res.json()) as any;
    expect(body.events).toHaveLength(2);
    expect(body.events[0].id).toBe(evt2);
    expect(body.events[1].id).toBe(evt3);
  });

  it("parses headers from JSON string to object", async () => {
    const { id: channelId, authToken } = createChannel();
    insertEvent(channelId);

    const res = await app.request(
      `/api/channels/${channelId}/poll`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );

    const body = (await res.json()) as any;
    expect(body.events[0].headers).toEqual({
      "content-type": "application/json",
    });
  });
});

describe("ack endpoint", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    initMemoryDb();
    const result = createApp();
    app = result.app;
  });

  afterEach(() => {
    closeDb();
  });

  function createChannel() {
    const db = getDb();
    const id = `${CHANNEL_ID_PREFIX}${nanoid(16)}`;
    const authToken = `${TOKEN_PREFIX}${nanoid(24)}`;
    db.insert(schema.channels)
      .values({
        id,
        name: "test",
        authToken,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .run();
    return { id, authToken };
  }

  function insertEvent(channelId: string) {
    const db = getDb();
    const id = `${EVENT_ID_PREFIX}${nanoid(16)}`;
    db.insert(schema.events)
      .values({
        id,
        channelId,
        headers: JSON.stringify({}),
        body: "{}",
        method: "POST",
        sourceIp: "127.0.0.1",
        receivedAt: Math.floor(Date.now() / 1000),
        attempts: 0,
      })
      .run();
    return id;
  }

  it("marks events as delivered", async () => {
    const { id: channelId, authToken } = createChannel();
    const evtId = insertEvent(channelId);

    const res = await app.request(`/api/channels/${channelId}/ack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ eventIds: [evtId] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.acknowledged).toBe(1);

    // Verify event is now delivered — poll should return nothing
    const pollRes = await app.request(
      `/api/channels/${channelId}/poll`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    const pollBody = (await pollRes.json()) as any;
    expect(pollBody.events).toHaveLength(0);
  });

  it("requires auth token", async () => {
    const { id: channelId } = createChannel();

    const res = await app.request(`/api/channels/${channelId}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventIds: ["evt_test"] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects empty eventIds", async () => {
    const { id: channelId, authToken } = createChannel();

    const res = await app.request(`/api/channels/${channelId}/ack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ eventIds: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("only acks events belonging to the channel", async () => {
    const ch1 = createChannel();
    const ch2 = createChannel();
    const evtCh2 = insertEvent(ch2.id);

    // Try to ack ch2's event using ch1's endpoint
    const res = await app.request(`/api/channels/${ch1.id}/ack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ch1.authToken}`,
      },
      body: JSON.stringify({ eventIds: [evtCh2] }),
    });

    const body = (await res.json()) as any;
    expect(body.acknowledged).toBe(0);
  });
});
