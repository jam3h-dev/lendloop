/**
 * Pure authorization + validation rules. Every Convex function calls these,
 * and tests/rbac.test.ts tests them directly. No Convex imports here on purpose.
 */

export type Role = "user" | "admin";
export type LoanStatus = "pending" | "approved" | "declined" | "returned";

export type Actor = { _id: string; role: Role };
export type ToolLike = { ownerId: string; isAvailable: boolean };
export type LoanLike = { ownerId: string; borrowerId: string; status: LoanStatus };

export class PolicyError extends Error {}

// ---- Roles ----------------------------------------------------------------

/** Admin bootstrap: role comes only from the server-side ADMIN_CLERK_IDS env. */
export function roleForClerkId(clerkId: string, adminClerkIds?: string): Role {
  const admins = (adminClerkIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return admins.includes(clerkId) ? "admin" : "user";
}

// ---- Tools ------------------------------------------------------------------

export const canEditTool = (actor: Actor, tool: ToolLike) =>
  actor._id === tool.ownerId;

export const canDeleteTool = (actor: Actor, tool: ToolLike) =>
  actor.role === "admin" || actor._id === tool.ownerId;

export const canRequestTool = (actor: Actor, tool: ToolLike) =>
  tool.isAvailable && actor._id !== tool.ownerId;

// ---- Loans ------------------------------------------------------------------

/** Only the owner of the tool may approve / decline / mark returned. */
export const canDecideLoan = (actor: Actor, loan: LoanLike) =>
  actor._id === loan.ownerId;

const TRANSITIONS: Record<LoanStatus, LoanStatus[]> = {
  pending: ["approved", "declined"],
  approved: ["returned"],
  declined: [],
  returned: [],
};

export const isValidTransition = (from: LoanStatus, to: LoanStatus) =>
  TRANSITIONS[from].includes(to);

// ---- Admin ------------------------------------------------------------------

export const canSetTrustedLender = (actor: Actor) => actor.role === "admin";
export const canViewAllLoans = (actor: Actor) => actor.role === "admin";

// ---- Dates ------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function todayUtc(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Throws PolicyError when the range is invalid. ISO strings compare lexically.
 * The browser picks dates in the user's LOCAL time, which west of UTC can be
 * one day behind UTC. One day of grace keeps "today" valid everywhere.
 */
export function assertValidDateRange(
  startDate: string,
  endDate: string,
  today = todayUtc(),
) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new PolicyError("Dates must be valid YYYY-MM-DD values.");
  }
  if (endDate < startDate) {
    throw new PolicyError("End date must be on or after start date.");
  }
  const earliest = todayUtc(Date.parse(`${today}T00:00:00Z`) - 86_400_000);
  if (startDate < earliest) {
    throw new PolicyError("Start date cannot be in the past.");
  }
}

/** Inclusive date ranges overlap. */
export const rangesOverlap = (
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
) => aStart <= bEnd && bStart <= aEnd;

// ---- Input limits -----------------------------------------------------------

export function cleanText(value: string, field: string, max: number, min = 1) {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new PolicyError(`${field} must be ${min}-${max} characters.`);
  }
  return trimmed;
}
