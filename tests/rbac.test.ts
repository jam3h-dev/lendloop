import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  type Actor,
  assertValidDateRange,
  canDecideLoan,
  canDeleteTool,
  canEditTool,
  canRequestTool,
  canSetTrustedLender,
  canViewAllLoans,
  isValidTransition,
  rangesOverlap,
  roleForClerkId,
} from "../convex/lib/policy";
import { type Backend, identities, isoDay, newBackend } from "./setup";

// ---------------------------------------------------------------------------
// Pure policy (the exact functions every Convex mutation calls)
// ---------------------------------------------------------------------------

const alice: Actor = { _id: "alice", role: "user" };
const bob: Actor = { _id: "bob", role: "user" };
const admin: Actor = { _id: "root", role: "admin" };
const alicesTool = { ownerId: "alice", isAvailable: true };
const loanOnAlicesTool = { ownerId: "alice", borrowerId: "bob", status: "pending" as const };

describe("authorization policy", () => {
  it("a user cannot edit or delete another user's tool", () => {
    expect(canEditTool(bob, alicesTool)).toBe(false);
    expect(canDeleteTool(bob, alicesTool)).toBe(false);
  });

  it("the owner can edit and delete their own tool", () => {
    expect(canEditTool(alice, alicesTool)).toBe(true);
    expect(canDeleteTool(alice, alicesTool)).toBe(true);
  });

  it("an admin can delete any listing but does not silently become its editor", () => {
    expect(canDeleteTool(admin, alicesTool)).toBe(true);
    expect(canEditTool(admin, alicesTool)).toBe(false);
  });

  it("a user cannot approve/decline/return a loan on another owner's tool", () => {
    expect(canDecideLoan(bob, loanOnAlicesTool)).toBe(false); // even the borrower
    expect(canDecideLoan({ _id: "carol", role: "user" }, loanOnAlicesTool)).toBe(false);
    expect(canDecideLoan(alice, loanOnAlicesTool)).toBe(true);
  });

  it("only admins can set trustedLender or view all loans", () => {
    expect(canSetTrustedLender(alice)).toBe(false);
    expect(canViewAllLoans(alice)).toBe(false);
    expect(canSetTrustedLender(admin)).toBe(true);
    expect(canViewAllLoans(admin)).toBe(true);
  });

  it("nobody can borrow their own tool or an unavailable tool", () => {
    expect(canRequestTool(alice, alicesTool)).toBe(false);
    expect(canRequestTool(bob, alicesTool)).toBe(true);
    expect(canRequestTool(bob, { ...alicesTool, isAvailable: false })).toBe(false);
  });

  it("admin role only comes from ADMIN_CLERK_IDS", () => {
    expect(roleForClerkId("user_1", "user_1, user_2")).toBe("admin");
    expect(roleForClerkId("user_2", "user_1, user_2")).toBe("admin");
    expect(roleForClerkId("user_3", "user_1, user_2")).toBe("user");
    expect(roleForClerkId("user_1", undefined)).toBe("user");
    expect(roleForClerkId("", ",,")).toBe("user");
  });

  it("loan status follows the allowed transitions only", () => {
    expect(isValidTransition("pending", "approved")).toBe(true);
    expect(isValidTransition("pending", "declined")).toBe(true);
    expect(isValidTransition("approved", "returned")).toBe(true);
    expect(isValidTransition("pending", "returned")).toBe(false);
    expect(isValidTransition("declined", "approved")).toBe(false);
    expect(isValidTransition("returned", "approved")).toBe(false);
  });

  it("date ranges are validated and overlaps detected", () => {
    const today = "2026-05-10";
    expect(() => assertValidDateRange("2026-05-12", "2026-05-11", today)).toThrow(/End date/);
    expect(() => assertValidDateRange("2026-02-30", "2026-03-01", today)).toThrow(/valid/);
    expect(() => assertValidDateRange("2026-05-10", "2026-05-10", today)).not.toThrow();
    // 1 day of grace: a user west of UTC whose local "today" is still UTC yesterday.
    expect(() => assertValidDateRange("2026-05-09", "2026-05-11", today)).not.toThrow();
    expect(() => assertValidDateRange("2026-05-08", "2026-05-11", today)).toThrow(/past/);
    // Grace crosses month and year boundaries correctly.
    expect(() => assertValidDateRange("2026-02-28", "2026-03-02", "2026-03-01")).not.toThrow();
    expect(() => assertValidDateRange("2025-12-31", "2026-01-02", "2026-01-01")).not.toThrow();
    expect(() => assertValidDateRange("2025-12-30", "2026-01-02", "2026-01-01")).toThrow(/past/);
    expect(rangesOverlap("2026-05-01", "2026-05-05", "2026-05-05", "2026-05-09")).toBe(true);
    expect(rangesOverlap("2026-05-01", "2026-05-04", "2026-05-05", "2026-05-09")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Enforcement inside the real Convex functions (convex-test in-memory backend)
// ---------------------------------------------------------------------------

async function seed(t: Backend) {
  const owner = t.withIdentity(identities.owner);
  const borrower = t.withIdentity(identities.borrower);
  const adminUser = t.withIdentity(identities.admin);
  await owner.mutation(api.users.store, {});
  await borrower.mutation(api.users.store, {});
  await adminUser.mutation(api.users.store, {});
  const toolId = await owner.mutation(api.tools.createTool, {
    name: "Cordless Drill",
    category: "power_tools",
    condition: "good",
    description: "18V, two batteries",
  });
  return { owner, borrower, adminUser, toolId };
}

describe("Convex functions enforce RBAC server-side", () => {
  it("ADMIN_CLERK_IDS bootstraps the admin; everyone else is a user", async () => {
    const t = newBackend();
    const { owner, adminUser } = await seed(t);
    expect((await owner.query(api.users.me, {}))?.role).toBe("user");
    expect((await adminUser.query(api.users.me, {}))?.role).toBe("admin");
  });

  it("a user cannot edit or delete another user's tool", async () => {
    const t = newBackend();
    const { borrower, toolId } = await seed(t);
    await expect(borrower.mutation(api.tools.updateTool, { toolId, name: "Mine now" })).rejects.toThrow(
      /only edit your own/,
    );
    await expect(borrower.mutation(api.tools.deleteTool, { toolId })).rejects.toThrow(/only delete your own/);
  });

  it("a user cannot approve a loan on another owner's tool, the owner can", async () => {
    const t = newBackend();
    const { owner, borrower, toolId } = await seed(t);
    const loanId = await borrower.mutation(api.loans.requestLoan, {
      toolId,
      startDate: isoDay(1),
      endDate: isoDay(3),
    });
    await expect(borrower.mutation(api.loans.updateLoanStatus, { loanId, status: "approved" })).rejects.toThrow(
      /Only the tool owner/,
    );
    await owner.mutation(api.loans.updateLoanStatus, { loanId, status: "approved" });
    const [incoming] = await owner.query(api.loans.listIncomingRequests, {});
    expect(incoming.status).toBe("approved");
  });

  it("a user cannot set trustedLender or list all loans; an admin can", async () => {
    const t = newBackend();
    const { owner, borrower, adminUser } = await seed(t);
    const ownerMe = await owner.query(api.users.me, {});
    await expect(borrower.mutation(api.admin.setTrustedLender, { userId: ownerMe!._id, trusted: true })).rejects.toThrow(
      /Admin only/,
    );
    await expect(borrower.query(api.admin.listAllLoans, {})).rejects.toThrow(/Admin only/);

    await adminUser.mutation(api.admin.setTrustedLender, { userId: ownerMe!._id, trusted: true });
    expect((await owner.query(api.users.me, {}))?.trustedLender).toBe(true);
  });

  it("removing an ID from ADMIN_CLERK_IDS revokes admin at once, before any re-sync", async () => {
    const t = newBackend();
    const { adminUser, owner, toolId } = await seed(t);
    const ownerMe = await owner.query(api.users.me, {});
    expect((await adminUser.query(api.users.me, {}))?.role).toBe("admin");

    process.env.ADMIN_CLERK_IDS = ""; // admin removed; users.store is NOT called again

    await expect(adminUser.query(api.admin.listAllLoans, {})).rejects.toThrow(/Admin only/);
    await expect(adminUser.query(api.admin.listLenders, {})).rejects.toThrow(/Admin only/);
    await expect(
      adminUser.mutation(api.admin.setTrustedLender, { userId: ownerMe!._id, trusted: true }),
    ).rejects.toThrow(/Admin only/);
    await expect(adminUser.mutation(api.tools.deleteTool, { toolId })).rejects.toThrow(/only delete your own/);
    expect((await adminUser.query(api.users.me, {}))?.role).toBe("user");

    // The stored row still says "admin": access no longer depends on it.
    const row = await t.run((ctx) =>
      ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", identities.admin.subject)).unique(),
    );
    expect(row?.role).toBe("admin");
  });

  it("an admin can remove any listing", async () => {
    const t = newBackend();
    const { adminUser, owner, toolId } = await seed(t);
    await adminUser.mutation(api.tools.deleteTool, { toolId });
    expect(await owner.query(api.tools.listMyTools, {})).toEqual([]);
  });

  it("unauthenticated callers cannot mutate", async () => {
    const t = newBackend();
    await expect(
      t.mutation(api.tools.createTool, { name: "x", category: "other", condition: "fair", description: "" }),
    ).rejects.toThrow(/Not signed in/);
  });

  it("borrowing: no own tools, end >= start, no overlap with approved loans", async () => {
    const t = newBackend();
    const { owner, borrower, toolId } = await seed(t);
    await expect(
      owner.mutation(api.loans.requestLoan, { toolId, startDate: isoDay(1), endDate: isoDay(2) }),
    ).rejects.toThrow(/own tool/);
    await expect(
      borrower.mutation(api.loans.requestLoan, { toolId, startDate: isoDay(3), endDate: isoDay(2) }),
    ).rejects.toThrow(/End date/);

    const loanId = await borrower.mutation(api.loans.requestLoan, { toolId, startDate: isoDay(1), endDate: isoDay(5) });
    await owner.mutation(api.loans.updateLoanStatus, { loanId, status: "approved" });

    const third = t.withIdentity({ subject: "user_third", givenName: "Cy" });
    await third.mutation(api.users.store, {});
    await expect(
      third.mutation(api.loans.requestLoan, { toolId, startDate: isoDay(4), endDate: isoDay(6) }),
    ).rejects.toThrow(/overlap/);
  });

  it("the public list exposes only _id, name and category", async () => {
    const t = newBackend();
    await seed(t);
    const tools = await t.query(api.tools.listPublicAvailableTools, {});
    expect(tools).toHaveLength(1);
    expect(Object.keys(tools[0]).sort()).toEqual(["_id", "category", "name"]);
  });

  it("user sync stores only a short display name from the token claims", async () => {
    const t = newBackend();
    const nameOf = async (identity: Record<string, string>) => {
      const as = t.withIdentity(identity);
      await as.mutation(api.users.store, {});
      return (await as.query(api.users.me, {}))?.displayName;
    };
    expect(await nameOf({ subject: "u1", givenName: "Ava", familyName: "Kim" })).toBe("Ava K.");
    expect(await nameOf({ subject: "u2", name: "Ben Carter Lee" })).toBe("Ben L.");
    expect(await nameOf({ subject: "u3", nickname: "toolfan" })).toBe("toolfan");
    expect(await nameOf({ subject: "u4" })).toBe("Neighbor");
  });
});
