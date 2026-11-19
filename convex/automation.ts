import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  nowSeconds,
  signPayload,
} from "./lib/hmac";
import {
  automationEventTypeValidator,
  automationStatusValidator,
  loanStatusValidator,
} from "./schema";

const MAX_ATTEMPTS = 3;
const OVERDUE_LIMIT = 100;

const EVENT_TYPES = {
  pending: "loan_requested",
  approved: "loan_approved",
  declined: "loan_declined",
  returned: "loan_returned",
} as const;

/** Minimal data needed to build an outgoing notification. */
export const loanSnapshot = internalQuery({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    const [tool, owner, borrower] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(loan.ownerId),
      ctx.db.get(loan.borrowerId),
    ]);
    return {
      toolName: tool?.name ?? "Deleted tool",
      startDate: loan.startDate,
      endDate: loan.endDate,
      ownerName: owner?.displayName ?? "Neighbor",
      borrowerName: borrower?.displayName ?? "Neighbor",
    };
  },
});

/**
 * Outgoing, HMAC-signed webhook to n8n. Scheduled with runAfter(0) from the
 * loan mutations so the user's transaction never waits on n8n.
 * Retries with backoff using the SAME eventId, so n8n's write-back key
 * (`notif:${eventId}`) stays idempotent. Final failure is recorded, never silent.
 */
export const sendLoanEvent = internalAction({
  args: {
    loanId: v.id("loans"),
    status: loanStatusValidator,
    toolName: v.optional(v.string()),
    eventId: v.optional(v.string()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const url = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      console.warn("N8N_REQUEST_WEBHOOK_URL or N8N_WEBHOOK_SECRET not set; skipping notification.");
      return;
    }
    const snap = await ctx.runQuery(internal.automation.loanSnapshot, {
      loanId: args.loanId,
    });
    if (!snap) return;

    const eventId = args.eventId ?? crypto.randomUUID();
    const attempt = args.attempt ?? 1;
    // Zero unnecessary PII: no emails, no Clerk ids, no internal user ids.
    const rawBody = JSON.stringify({
      eventId,
      eventType: EVENT_TYPES[args.status],
      loanId: args.loanId,
      toolName: args.toolName ?? snap.toolName,
      status: args.status,
      startDate: snap.startDate,
      endDate: snap.endDate,
      recipientDisplayName:
        args.status === "pending" ? snap.ownerName : snap.borrowerName,
    });
    const timestamp = nowSeconds();
    const signature = await signPayload(secret, timestamp, rawBody);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
        },
        body: rawBody,
      });
      if (!res.ok) throw new Error(`n8n responded ${res.status}`);
    } catch (error) {
      console.error(`Notification ${eventId} attempt ${attempt} failed:`, error);
      if (attempt < MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          2000 * 2 ** (attempt - 1),
          internal.automation.sendLoanEvent,
          { ...args, eventId, attempt: attempt + 1 },
        );
        return;
      }
      await ctx.runMutation(internal.automation.recordAutomationEvent, {
        idempotencyKey: `dispatch:${eventId}`,
        loanId: args.loanId,
        eventType: "request_notification",
        status: "failed",
        summary: `Notification failed after ${attempt} attempts`,
      });
    }
  },
});

/**
 * Idempotent write-back. Lookup, insert and loan patch run in ONE mutation,
 * which Convex executes as a serializable transaction, so two concurrent
 * retries with the same key cannot both insert.
 */
export const recordAutomationEvent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    loanId: v.string(),
    eventType: automationEventTypeValidator,
    status: automationStatusValidator,
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (existing) return { ok: true as const, deduplicated: true };

    const loanId = ctx.db.normalizeId("loans", args.loanId);
    const loan = loanId ? await ctx.db.get(loanId) : null;
    if (!loanId || !loan) return { ok: false as const, error: "loan_not_found" };

    const now = Date.now();
    await ctx.db.insert("automationEvents", {
      idempotencyKey: args.idempotencyKey,
      loanId,
      eventType: args.eventType,
      status: args.status,
      summary: args.summary,
      createdAt: now,
    });
    await ctx.db.patch(loanId, {
      lastAutomationSummary: args.summary,
      // Only a delivered overdue reminder counts as "reminded today".
      ...(args.eventType === "overdue_reminder" &&
        args.status === "sent" && { lastReminderAt: now }),
    });
    return { ok: true as const, deduplicated: false };
  },
});

/** Approved loans past their end date that were not reminded today (UTC). */
export const listOverdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const startOfToday = Date.parse(`${today}T00:00:00Z`);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) =>
        q.eq("status", "approved").lt("endDate", today),
      )
      .take(OVERDUE_LIMIT);
    const due = loans.filter(
      (l) => l.lastReminderAt === undefined || l.lastReminderAt < startOfToday,
    );
    return Promise.all(
      due.map(async (loan) => {
        const [tool, borrower] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.borrowerId),
        ]);
        return {
          loanId: loan._id,
          toolName: tool?.name ?? "Deleted tool",
          endDate: loan.endDate,
          daysOverdue: Math.round(
            (startOfToday - Date.parse(`${loan.endDate}T00:00:00Z`)) / 86_400_000,
          ),
          recipientDisplayName: borrower?.displayName ?? "Neighbor",
        };
      }),
    );
  },
});
