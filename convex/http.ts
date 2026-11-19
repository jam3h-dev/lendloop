import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { verifyRequest } from "./lib/hmac";
import { isIsoDate, todayUtc } from "./lib/policy";

const MAX_BODY_BYTES = 8 * 1024;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Never tell the caller which check failed; log it server-side instead. */
function reject(reason: string) {
  console.warn(`Rejected automation request: ${reason}`);
  return reason === "server_misconfigured"
    ? json({ error: "server_misconfigured" }, 500)
    : json({ error: "unauthorized" }, 401);
}

type WriteBack = {
  idempotencyKey: string;
  loanId: string;
  eventType: "request_notification" | "overdue_reminder";
  status: "sent" | "failed";
  summary: string;
};

/** Strict validation of the n8n write-back body. */
function parseWriteBack(body: unknown): WriteBack | string {
  if (typeof body !== "object" || body === null) return "body_must_be_object";
  const b = body as Record<string, unknown>;
  const { idempotencyKey, loanId, eventType, status, summary } = b;

  if (typeof loanId !== "string" || !loanId || loanId.length > 64 || loanId.includes(":")) {
    return "invalid_loanId";
  }
  if (eventType !== "request_notification" && eventType !== "overdue_reminder") {
    return "invalid_eventType";
  }
  if (status !== "sent" && status !== "failed") return "invalid_status";
  if (typeof summary !== "string" || summary.length < 1 || summary.length > 280) {
    return "invalid_summary";
  }
  if (typeof idempotencyKey !== "string") return "missing_idempotencyKey";

  // Key format is bound to the event it describes, so keys cannot be forged
  // for another loan or reused across event types.
  if (eventType === "overdue_reminder") {
    const [prefix, keyLoanId, date, ...rest] = idempotencyKey.split(":");
    if (prefix !== "overdue" || keyLoanId !== loanId || !isIsoDate(date ?? "") || rest.length) {
      return "invalid_idempotencyKey";
    }
  } else if (!/^notif:[0-9a-f-]{36}$/.test(idempotencyKey)) {
    return "invalid_idempotencyKey";
  }
  return { idempotencyKey, loanId, eventType, status, summary: summary.trim() };
}

const http = httpRouter();

http.route({
  path: "/api/automation/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const verdict = await verifyRequest(request, ""); // GET signs an empty body
    if (!verdict.ok) return reject(verdict.reason);

    const today = todayUtc();
    const loans = await ctx.runQuery(internal.automation.listOverdueLoans, { today });
    return json({ date: today, count: loans.length, loans }, 200);
  }),
});

http.route({
  path: "/api/automation/reminder-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }
    const rawBody = await request.text(); // read once; verify these exact bytes
    if (rawBody.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

    const verdict = await verifyRequest(request, rawBody);
    if (!verdict.ok) return reject(verdict.reason);

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const parsed = parseWriteBack(body);
    if (typeof parsed === "string") return json({ error: parsed }, 400);

    const result = await ctx.runMutation(
      internal.automation.recordAutomationEvent,
      parsed,
    );
    if (!result.ok) return json({ error: result.error }, 404);
    return json({ ok: true, deduplicated: result.deduplicated }, 200);
  }),
});

export default http;
