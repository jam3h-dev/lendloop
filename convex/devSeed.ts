import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { todayUtc } from "./lib/policy";

/**
 * Demo helper for workflow 02. Internal: browsers cannot call it; only the
 * Convex CLI / dashboard (deployment admin) can.
 *
 *   npx convex run devSeed:overdueLoan '{"borrowerClerkId":"user_..."}'
 *
 * Creates an APPROVED loan that ended 3 days ago. Without borrowerClerkId the
 * borrower is a "Demo Borrower" placeholder user.
 */
export const overdueLoan = internalMutation({
  args: { borrowerClerkId: v.optional(v.string()) },
  handler: async (ctx, { borrowerClerkId }) => {
    const now = Date.now();
    const byClerkId = (clerkId: string) =>
      ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
        .unique();
    const demoUser = async (clerkId: string, displayName: string) =>
      (await byClerkId(clerkId))?._id ??
      (await ctx.db.insert("users", {
        clerkId,
        displayName,
        role: "user",
        trustedLender: false,
        createdAt: now,
      }));

    let borrowerId;
    if (borrowerClerkId) {
      const borrower = await byClerkId(borrowerClerkId);
      if (!borrower) throw new ConvexError("No user with that Clerk ID. Sign in once first.");
      borrowerId = borrower._id;
    } else {
      borrowerId = await demoUser("demo_borrower", "Demo Borrower");
    }
    const ownerId = await demoUser("demo_owner", "Demo Owner");
    const toolId = await ctx.db.insert("tools", {
      ownerId,
      name: "Demo Ladder",
      category: "other",
      condition: "good",
      description: "Seeded for the overdue-reminder demo.",
      isAvailable: false,
      createdAt: now,
      updatedAt: now,
    });
    const day = (offset: number) => todayUtc(now + offset * 86_400_000);
    return await ctx.db.insert("loans", {
      toolId,
      ownerId,
      borrowerId,
      startDate: day(-7),
      endDate: day(-3),
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
  },
});
