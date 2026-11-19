import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { PolicyError } from "./policy";

/**
 * The caller is resolved ONLY from the verified Clerk JWT (identity.subject).
 * No Convex function accepts a userId or role from the client.
 */
export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) throw new ConvexError("Not signed in.");
  return user;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw new ConvexError("Admin only.");
  return user;
}

/** Throw a client-visible error when a policy check fails. */
export function ensure(allowed: boolean, message = "Not allowed."): void {
  if (!allowed) throw new ConvexError(message);
}

/** Run a policy validator and convert PolicyError into a ConvexError. */
export function check<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof PolicyError) throw new ConvexError(error.message);
    throw error;
  }
}
