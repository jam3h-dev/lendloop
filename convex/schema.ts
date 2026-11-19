import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const roleValidator = v.union(v.literal("user"), v.literal("admin"));

export const categoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("other"),
);

export const conditionValidator = v.union(
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
);

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
);

export const automationEventTypeValidator = v.union(
  v.literal("request_notification"),
  v.literal("overdue_reminder"),
);

export const automationStatusValidator = v.union(
  v.literal("sent"),
  v.literal("failed"),
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    displayName: v.string(),
    role: roleValidator,
    trustedLender: v.boolean(),
    createdAt: v.number(),
  }).index("by_clerkId", ["clerkId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    isAvailable: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_isAvailable", ["isAvailable"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // ISO YYYY-MM-DD
    endDate: v.string(), // ISO YYYY-MM-DD
    status: loanStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    lastReminderAt: v.optional(v.number()),
    lastAutomationSummary: v.optional(v.string()),
  })
    .index("by_toolId", ["toolId"])
    .index("by_ownerId", ["ownerId"])
    .index("by_borrowerId", ["borrowerId"])
    .index("by_status_endDate", ["status", "endDate"]),

  automationEvents: defineTable({
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    eventType: automationEventTypeValidator,
    status: automationStatusValidator,
    summary: v.string(),
    createdAt: v.number(),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_loanId", ["loanId"]),
});
