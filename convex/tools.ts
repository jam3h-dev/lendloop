import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { check, ensure, getCurrentUser, requireUser } from "./lib/auth";
import { canDeleteTool, canEditTool, cleanText } from "./lib/policy";
import { categoryValidator, conditionValidator } from "./schema";

// Note: fixed page sizes; switch to paginationOpts when listings grow past this.
const PUBLIC_LIMIT = 200;
const BROWSE_LIMIT = 300;

/**
 * Public, unauthenticated. Data minimization happens HERE, at the query layer:
 * only { _id, name, category } leave the server. No owner, description or PII.
 */
export const listPublicAvailableTools = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_isAvailable", (q) => q.eq("isAvailable", true))
      .order("desc")
      .take(PUBLIC_LIMIT);
    return tools.map(({ _id, name, category }) => ({ _id, name, category }));
  },
});

/** Signed-in browse view: all tools with owner display name + trusted badge. */
export const listBrowseTools = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (!me) return [];
    const tools = await ctx.db.query("tools").order("desc").take(BROWSE_LIMIT);
    const owners = new Map<Id<"users">, { displayName: string; trusted: boolean }>();
    for (const t of tools) {
      if (owners.has(t.ownerId)) continue;
      const owner = await ctx.db.get(t.ownerId);
      owners.set(t.ownerId, {
        displayName: owner?.displayName ?? "Unknown",
        trusted: owner?.trustedLender ?? false,
      });
    }
    return tools.map((t) => ({
      _id: t._id,
      name: t.name,
      category: t.category,
      condition: t.condition,
      description: t.description,
      isAvailable: t.isAvailable,
      ownerDisplayName: owners.get(t.ownerId)!.displayName,
      ownerTrusted: owners.get(t.ownerId)!.trusted,
      isMine: t.ownerId === me._id,
    }));
  },
});

export const listMyTools = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (!me) return [];
    return await ctx.db
      .query("tools")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
  },
});

export const createTool = mutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const now = Date.now();
    return await ctx.db.insert("tools", {
      ownerId: me._id, // owner is always the caller, never a client argument
      name: check(() => cleanText(args.name, "Name", 80)),
      category: args.category,
      condition: args.condition,
      description: check(() => cleanText(args.description, "Description", 1000, 0)),
      isAvailable: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTool = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.optional(v.string()),
    category: v.optional(categoryValidator),
    condition: v.optional(conditionValidator),
    description: v.optional(v.string()),
    isAvailable: v.optional(v.boolean()),
  },
  handler: async (ctx, { toolId, ...fields }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    ensure(canEditTool(me, tool), "You can only edit your own listings.");

    await ctx.db.patch(toolId, {
      ...(fields.name !== undefined && {
        name: check(() => cleanText(fields.name!, "Name", 80)),
      }),
      ...(fields.description !== undefined && {
        description: check(() =>
          cleanText(fields.description!, "Description", 1000, 0),
        ),
      }),
      ...(fields.category !== undefined && { category: fields.category }),
      ...(fields.condition !== undefined && { condition: fields.condition }),
      ...(fields.isAvailable !== undefined && { isAvailable: fields.isAvailable }),
      updatedAt: Date.now(),
    });
  },
});

/** Owner deletes own listing; admin deletes any listing. Pending requests are declined. */
export const deleteTool = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    ensure(canDeleteTool(me, tool), "You can only delete your own listings.");

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_toolId", (q) => q.eq("toolId", toolId))
      .collect();
    for (const loan of loans) {
      if (loan.status !== "pending") continue;
      await ctx.db.patch(loan._id, { status: "declined", updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.automation.sendLoanEvent, {
        loanId: loan._id,
        status: "declined",
        toolName: tool.name,
      });
    }
    await ctx.db.delete(toolId);
  },
});
