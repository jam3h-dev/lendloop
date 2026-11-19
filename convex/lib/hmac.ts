/**
 * Shared HMAC-SHA256 wire contract between Convex and n8n (both directions).
 *
 *   signature = hex( HMAC_SHA256( N8N_WEBHOOK_SECRET, `${timestamp}.${rawBody}` ) )
 *   headers   = X-LendLoop-Timestamp: <unix seconds>
 *               X-LendLoop-Signature: <lowercase hex>
 *
 * For GET requests rawBody is the empty string.
 *
 * Uses Web Crypto only (crypto.subtle) because Convex HTTP actions and the
 * default Convex runtime are V8 isolates without `node:crypto`.
 */

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const MAX_SKEW_SECONDS = 5 * 60;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function signPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  return toHex(mac);
}

/** Constant-time string compare (XOR accumulate, no early exit on content). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function nowSeconds(): string {
  return Math.floor(Date.now() / 1000).toString();
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "server_misconfigured"
        | "missing_signature_headers"
        | "invalid_timestamp"
        | "stale_timestamp"
        | "bad_signature";
    };

export async function verifySignature(input: {
  secret: string | undefined;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  rawBody: string;
  nowMs?: number;
}): Promise<VerifyResult> {
  const { secret, signature, timestamp, rawBody } = input;
  if (!secret) return { ok: false, reason: "server_misconfigured" };
  if (!signature || !timestamp) {
    return { ok: false, reason: "missing_signature_headers" };
  }
  if (!/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  // Rejects both stale (replayed) and far-future timestamps.
  if (Math.abs(nowSec - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const expected = await signPayload(secret, timestamp, rawBody);
  return timingSafeEqual(expected, signature.trim().toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}

/** Verify a Request whose body has already been read as text. */
export function verifyRequest(request: Request, rawBody: string) {
  return verifySignature({
    secret: process.env.N8N_WEBHOOK_SECRET,
    signature: request.headers.get(SIGNATURE_HEADER),
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    rawBody,
  });
}
