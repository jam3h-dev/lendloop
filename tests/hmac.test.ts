import { describe, expect, it } from "vitest";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signPayload,
  timingSafeEqual,
  verifySignature,
} from "../convex/lib/hmac";
import { TEST_SECRET, newBackend, signedHeaders } from "./setup";

const body = JSON.stringify({ hello: "world" });
const nowMs = 1_700_000_000_000;
const ts = String(nowMs / 1000);

describe("HMAC-SHA256 signing", () => {
  it("matches the Node crypto output used by the n8n Code nodes", async () => {
    // createHmac('sha256','test-secret').update('1700000000.{"hello":"world"}').digest('hex')
    expect(await signPayload("test-secret", "1700000000", body)).toBe(
      "f85455a1b55ea86f7a15f5f9923d0abc4b888da84ec485f2ff358f427776beca",
    );
  });

  it("valid signature passes", async () => {
    const signature = await signPayload(TEST_SECRET, ts, body);
    const result = await verifySignature({ secret: TEST_SECRET, signature, timestamp: ts, rawBody: body, nowMs });
    expect(result).toEqual({ ok: true });
  });

  it("tampered payload fails", async () => {
    const signature = await signPayload(TEST_SECRET, ts, body);
    const result = await verifySignature({
      secret: TEST_SECRET,
      signature,
      timestamp: ts,
      rawBody: body.replace("world", "w0rld"),
      nowMs,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("signature made with another secret fails", async () => {
    const signature = await signPayload("other-secret", ts, body);
    const result = await verifySignature({ secret: TEST_SECRET, signature, timestamp: ts, rawBody: body, nowMs });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("tampered timestamp fails (timestamp is inside the signed string)", async () => {
    const signature = await signPayload(TEST_SECRET, ts, body);
    const result = await verifySignature({
      secret: TEST_SECRET,
      signature,
      timestamp: String(Number(ts) + 1),
      rawBody: body,
      nowMs,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("expired timestamp (> 5 minutes old) fails, even with a correct signature", async () => {
    const oldTs = String(nowMs / 1000 - 301);
    const signature = await signPayload(TEST_SECRET, oldTs, body);
    const result = await verifySignature({ secret: TEST_SECRET, signature, timestamp: oldTs, rawBody: body, nowMs });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("timestamp far in the future fails", async () => {
    const futureTs = String(nowMs / 1000 + 301);
    const signature = await signPayload(TEST_SECRET, futureTs, body);
    const result = await verifySignature({ secret: TEST_SECRET, signature, timestamp: futureTs, rawBody: body, nowMs });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("timestamp just inside the 5 minute window passes", async () => {
    const edgeTs = String(nowMs / 1000 - 299);
    const signature = await signPayload(TEST_SECRET, edgeTs, body);
    const result = await verifySignature({ secret: TEST_SECRET, signature, timestamp: edgeTs, rawBody: body, nowMs });
    expect(result).toEqual({ ok: true });
  });

  it("missing signature or timestamp header fails", async () => {
    const signature = await signPayload(TEST_SECRET, ts, body);
    expect(await verifySignature({ secret: TEST_SECRET, signature: null, timestamp: ts, rawBody: body, nowMs }))
      .toEqual({ ok: false, reason: "missing_signature_headers" });
    expect(await verifySignature({ secret: TEST_SECRET, signature, timestamp: null, rawBody: body, nowMs }))
      .toEqual({ ok: false, reason: "missing_signature_headers" });
  });

  it("non-numeric timestamp fails", async () => {
    const result = await verifySignature({ secret: TEST_SECRET, signature: "ab", timestamp: "yesterday", rawBody: body, nowMs });
    expect(result).toEqual({ ok: false, reason: "invalid_timestamp" });
  });

  it("missing server secret fails closed", async () => {
    const result = await verifySignature({ secret: undefined, signature: "ab", timestamp: ts, rawBody: body, nowMs });
    expect(result).toEqual({ ok: false, reason: "server_misconfigured" });
  });

  it("timingSafeEqual compares full strings", () => {
    expect(timingSafeEqual("abcd", "abcd")).toBe(true);
    expect(timingSafeEqual("abcd", "abce")).toBe(false);
    expect(timingSafeEqual("abcd", "abc")).toBe(false);
  });
});

describe("HTTP endpoints enforce the signature", () => {
  it("GET /api/automation/overdue-loans: 401 without headers, 401 when stale, 200 when signed", async () => {
    const t = newBackend();
    expect((await t.fetch("/api/automation/overdue-loans")).status).toBe(401);

    const stale = String(Math.floor(Date.now() / 1000) - 400);
    const staleRes = await t.fetch("/api/automation/overdue-loans", { headers: await signedHeaders("", stale) });
    expect(staleRes.status).toBe(401);

    const ok = await t.fetch("/api/automation/overdue-loans", { headers: await signedHeaders("") });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ count: 0, loans: [] });
  });

  it("POST /api/automation/reminder-status: forged signature is rejected", async () => {
    const t = newBackend();
    const raw = JSON.stringify({ idempotencyKey: "notif:x", loanId: "x", eventType: "request_notification", status: "sent", summary: "x" });
    const res = await t.fetch("/api/automation/reminder-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000)),
        [SIGNATURE_HEADER]: "0".repeat(64),
      },
      body: raw,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" }); // no hint which check failed
  });
});
