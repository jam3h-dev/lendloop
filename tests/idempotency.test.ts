import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { type Backend, newBackend, signedHeaders } from "./setup";

async function seedOverdueLoan(t: Backend): Promise<Id<"loans">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const user = (name: string, clerkId: string) =>
      ctx.db.insert("users", { clerkId, displayName: name, role: "user", trustedLender: false, createdAt: now });
    const ownerId = await user("Ava K.", "user_owner");
    const borrowerId = await user("Ben L.", "user_borrower");
    const toolId = await ctx.db.insert("tools", {
      ownerId,
      name: "Ladder",
      category: "other",
      condition: "good",
      description: "",
      isAvailable: true,
      createdAt: now,
      updatedAt: now,
    });
    return ctx.db.insert("loans", {
      toolId,
      ownerId,
      borrowerId,
      startDate: "2020-01-01",
      endDate: "2020-01-05",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
  });
}

const countEvents = (t: Backend) => t.run(async (ctx) => (await ctx.db.query("automationEvents").collect()).length);

async function postWriteBack(t: Backend, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const res = await t.fetch("/api/automation/reminder-status", {
    method: "POST",
    headers: await signedHeaders(raw),
    body: raw,
  });
  return { status: res.status, json: await res.json() };
}

describe("idempotent write-backs", () => {
  it("the same idempotencyKey posted twice creates exactly one record", async () => {
    const t = newBackend();
    const loanId = await seedOverdueLoan(t);
    const key = `overdue:${loanId}:2026-11-19`;
    const body = { idempotencyKey: key, loanId, eventType: "overdue_reminder", status: "sent", summary: "Reminder sent" };

    const first = await postWriteBack(t, body);
    expect(first).toEqual({ status: 200, json: { ok: true, deduplicated: false } });

    // n8n retry / replay with a different summary must not create or overwrite anything.
    const second = await postWriteBack(t, { ...body, summary: "Replayed summary" });
    expect(second).toEqual({ status: 200, json: { ok: true, deduplicated: true } });

    expect(await countEvents(t)).toBe(1);
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.lastAutomationSummary).toBe("Reminder sent");
  });

  it("many concurrent retries with one key still produce one record", async () => {
    const t = newBackend();
    const loanId = await seedOverdueLoan(t);
    const args = {
      idempotencyKey: "notif:4b1f9a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
      loanId,
      eventType: "request_notification" as const,
      status: "sent" as const,
      summary: "Notification sent (approved)",
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => t.mutation(internal.automation.recordAutomationEvent, args)),
    );
    expect(results.filter((r) => r.ok && !r.deduplicated)).toHaveLength(1);
    expect(await countEvents(t)).toBe(1);
  });

  it("a delivered overdue reminder hides the loan from today's overdue list", async () => {
    const t = newBackend();
    const loanId = await seedOverdueLoan(t);
    const list = async () => {
      const res = await t.fetch("/api/automation/overdue-loans", { headers: await signedHeaders("") });
      return (await res.json()) as { date: string; loans: { loanId: string; daysOverdue: number }[] };
    };

    const before = await list();
    expect(before.loans.map((l) => l.loanId)).toEqual([loanId]);
    expect(Object.keys(before.loans[0]).sort()).toEqual(
      ["daysOverdue", "endDate", "loanId", "recipientDisplayName", "toolName"], // minimal fields only
    );

    await postWriteBack(t, {
      idempotencyKey: `overdue:${loanId}:${before.date}`,
      loanId,
      eventType: "overdue_reminder",
      status: "sent",
      summary: "Reminder sent",
    });
    expect((await list()).loans).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.lastReminderAt).toBeTypeOf("number");
  });

  it("a request notification write-back does not count as today's reminder", async () => {
    const t = newBackend();
    const loanId = await seedOverdueLoan(t);
    await postWriteBack(t, {
      idempotencyKey: "notif:4b1f9a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
      loanId,
      eventType: "request_notification",
      status: "sent",
      summary: "Notification sent",
    });
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.lastReminderAt).toBeUndefined();
  });

  it("rejects keys that are missing or bound to another loan", async () => {
    const t = newBackend();
    const loanId = await seedOverdueLoan(t);
    const base = { loanId, eventType: "overdue_reminder", status: "sent", summary: "x" };
    expect((await postWriteBack(t, base)).status).toBe(400);
    expect((await postWriteBack(t, { ...base, idempotencyKey: "overdue:someOtherLoan:2026-11-19" })).status).toBe(400);
    expect(await countEvents(t)).toBe(0);
  });
});
