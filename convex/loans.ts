import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { check, ensure, getCurrentUser, requireUser } from "./lib/auth";
import {
  assertValidDateRange,
  canDecideLoan,
  canRequestTool,
  isValidTransition,
  rangesOverlap,
} from "./lib/policy";

const LIST_LIMIT = 100;

async function approvedOverlapExists(
  ctx: QueryCtx | MutationCtx,
  toolId: Id<"tools">,
  startDate: string,
  endDate: string,
  ignoreLoanId?: Id<"loans">,
) {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_toolId", (q) => q.eq("toolId", toolId))
    .collect();
  return loans.some(
    (l) =>
      l._id !== ignoreLoanId &&
      l.status === "approved" &&
      rangesOverlap(startDate, endDate, l.startDate, l.endDate),
  );
}

/** Join tool name, counterpart display name and recent automation activity. */
async function withDetails(
  ctx: QueryCtx,
  loans: Doc<"loans">[],
  counterpart: "ownerId" | "borrowerId",
) {
  return Promise.all(
    loans.map(async (loan) => {
      const [tool, other, events] = await Promise.all([
        ctx.db.get(loan.toolId),
        ctx.db.get(loan[counterpart]),
        ctx.db
          .query("automationEvents")
          .withIndex("by_loanId", (q) => q.eq("loanId", loan._id))
          .order("desc")
          .take(3),
      ]);
      return {
        _id: loan._id,
        toolName: tool?.name ?? "Deleted tool",
        counterpartName: other?.displayName ?? "Unknown",
        startDate: loan.startDate,
        endDate: loan.endDate,
        status: loan.status,
        createdAt: loan.createdAt,
        lastReminderAt: loan.lastReminderAt,
        lastAutomationSummary: loan.lastAutomationSummary,
        recentAutomation: events.map((e) => ({
          eventType: e.eventType,
          status: e.status,
          summary: e.summary,
          createdAt: e.createdAt,
        })),
      };
    }),
  );
}

export const requestLoan = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    ensure(
      canRequestTool(me, tool),
      tool.ownerId === me._id
        ? "You cannot borrow your own tool."
        : "This tool is not available.",
    );
    check(() => assertValidDateRange(startDate, endDate));

    if (await approvedOverlapExists(ctx, toolId, startDate, endDate)) {
      throw new ConvexError("Those dates overlap an approved loan.");
    }
    const mine = await ctx.db
      .query("loans")
      .withIndex("by_borrowerId", (q) => q.eq("borrowerId", me._id))
      .collect();
    if (mine.some((l) => l.toolId === toolId && l.status === "pending")) {
      throw new ConvexError("You already have a pending request for this tool.");
    }

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId,
      ownerId: tool.ownerId, // taken from the tool, never from the client
      borrowerId: me._id,
      startDate,
      endDate,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.automation.sendLoanEvent, {
      loanId,
      status: "pending",
    });
    return loanId;
  },
});

/** Owner of the tool approves, declines, or marks a loan returned. */
export const updateLoanStatus = mutation({
  args: {
    loanId: v.id("loans"),
    status: v.union(
      v.literal("approved"),
      v.literal("declined"),
      v.literal("returned"),
    ),
  },
  handler: async (ctx, { loanId, status }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("Loan not found.");
    ensure(canDecideLoan(me, loan), "Only the tool owner can do this.");
    ensure(
      isValidTransition(loan.status, status),
      `Cannot change a ${loan.status} loan to ${status}.`,
    );
    if (
      status === "approved" &&
      (await approvedOverlapExists(ctx, loan.toolId, loan.startDate, loan.endDate, loanId))
    ) {
      throw new ConvexError("Those dates overlap another approved loan.");
    }

    await ctx.db.patch(loanId, { status, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.automation.sendLoanEvent, {
      loanId,
      status,
    });
  },
});

export const listMyRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (!me) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrowerId", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(LIST_LIMIT);
    return withDetails(ctx, loans, "ownerId");
  },
});

export const listIncomingRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (!me) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .take(LIST_LIMIT);
    return withDetails(ctx, loans, "borrowerId");
  },
});
