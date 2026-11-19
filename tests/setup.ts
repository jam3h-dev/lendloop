/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signPayload } from "../convex/lib/hmac";

export const TEST_SECRET = "test-secret-do-not-use-in-prod";

const modules = import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js", "!../convex/**/*.d.ts"]);

/** Fresh in-memory Convex backend running the real functions in convex/. */
export function newBackend() {
  process.env.N8N_WEBHOOK_SECRET = TEST_SECRET;
  process.env.ADMIN_CLERK_IDS = "user_admin";
  delete process.env.N8N_REQUEST_WEBHOOK_URL; // outgoing webhook becomes a no-op
  return convexTest(schema, modules);
}

export type Backend = ReturnType<typeof newBackend>;

export const identities = {
  owner: { subject: "user_owner", givenName: "Ava", familyName: "Kim" },
  borrower: { subject: "user_borrower", givenName: "Ben", familyName: "Lee" },
  admin: { subject: "user_admin", givenName: "Ada", familyName: "Admin" },
};

/** Headers n8n would send: HMAC-SHA256 over `${timestamp}.${rawBody}`. */
export async function signedHeaders(rawBody: string, timestamp?: string) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000).toString();
  return {
    "Content-Type": "application/json",
    [TIMESTAMP_HEADER]: ts,
    [SIGNATURE_HEADER]: await signPayload(TEST_SECRET, ts, rawBody),
  };
}

export function isoDay(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
