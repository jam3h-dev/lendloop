import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { roleForClerkId } from "./lib/policy";

/**
 * Upsert the signed-in user. Called by the client after Clerk sign-in.
 * Role is recomputed from ADMIN_CLERK_IDS on every sync, so the env var is
 * the single source of truth for admin access. Email and other Clerk PII are
 * never stored: only a short display name ("Sam K.").
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in.");

    // Claims come from the Clerk session token (see README: given_name /
    // family_name / name / nickname). Store only "First L.", never the full name.
    const full = identity.givenName
      ? `${identity.givenName} ${identity.familyName ?? ""}`
      : (identity.name ?? "");
    const [first, ...rest] = full.trim().split(/\s+/).filter(Boolean);
    const last = rest.at(-1);
    const displayName = (
      first
        ? `${first}${last ? ` ${last.charAt(0)}.` : ""}`
        : identity.nickname?.trim() || "Neighbor"
    ).slice(0, 60);
    const role = roleForClerkId(identity.subject, process.env.ADMIN_CLERK_IDS);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (existing) {
      if (existing.displayName !== displayName || existing.role !== role) {
        await ctx.db.patch(existing._id, { displayName, role });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      clerkId: identity.subject,
      displayName,
      role,
      trustedLender: false,
      createdAt: Date.now(),
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      displayName: user.displayName,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});
