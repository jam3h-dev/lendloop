import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensure, requireAdmin } from "./lib/auth";
import { canSetTrustedLender, canViewAllLoans } from "./lib/policy";

// Note: fixed admin page size; add pagination when the neighborhood grows.
const ADMIN_LIMIT = 500;

export const listAllLoans = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    ensure(canViewAllLoans(admin));
    const loans = await ctx.db.query("loans").order("desc").take(ADMIN_LIMIT);
    return Promise.all(
      loans.map(async (loan) => {
        const [tool, owner, borrower] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.ownerId),
          ctx.db.get(loan.borrowerId),
        ]);
        return {
          _id: loan._id,
          toolName: tool?.name ?? "Deleted tool",
          ownerName: owner?.displayName ?? "Unknown",
          borrowerName: borrower?.displayName ?? "Unknown",
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
          lastAutomationSummary: loan.lastAutomationSummary,
        };
      }),
    );
  },
});

/** Lenders = users with at least one listing (plus anyone already trusted). */
export const listLenders = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(ADMIN_LIMIT);
    const rows = await Promise.all(
      users.map(async (u) => {
        const tools = await ctx.db
          .query("tools")
          .withIndex("by_ownerId", (q) => q.eq("ownerId", u._id))
          .collect();
        return {
          _id: u._id,
          displayName: u.displayName,
          role: u.role,
          trustedLender: u.trustedLender,
          toolCount: tools.length,
        };
      }),
    );
    return rows.filter((r) => r.toolCount > 0 || r.trustedLender);
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const admin = await requireAdmin(ctx);
    ensure(canSetTrustedLender(admin), "Admin only.");
    const target = await ctx.db.get(userId);
    ensure(target !== null, "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});
