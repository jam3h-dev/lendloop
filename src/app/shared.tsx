"use client";

import { ConvexError } from "convex/values";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const CATEGORIES = {
  power_tools: "Power tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  other: "Other",
} as const;
export const CONDITIONS = { like_new: "Like new", good: "Good", fair: "Fair" } as const;
export type Category = keyof typeof CATEGORIES;
export type Condition = keyof typeof CONDITIONS;
export const catLabel = (c: string) => CATEGORIES[c as Category] ?? c;
export const condLabel = (c: string) => CONDITIONS[c as Condition] ?? c;

export const errMsg = (e: unknown) =>
  e instanceof ConvexError ? String(e.data) : "Something went wrong.";

const TONES = {
  amber: "bg-amber-100 text-amber-800",
  green: "bg-emerald-100 text-emerald-800",
  gray: "bg-zinc-200 text-zinc-700",
  blue: "bg-sky-100 text-sky-800",
  accent: "bg-teal-100 text-teal-800",
} as const;

export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONE = { pending: "amber", approved: "green", declined: "gray", returned: "blue" } as const;
export type Status = keyof typeof STATUS_TONE;
export const StatusBadge = ({ status }: { status: Status }) => (
  <Badge tone={STATUS_TONE[status]}>{status}</Badge>
);

export const inputCls = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm";

const VARIANTS = {
  primary: "bg-teal-700 text-white hover:bg-teal-800",
  secondary: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100",
  danger: "bg-red-600 text-white hover:bg-red-700",
} as const;

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return (
    <button
      type={type}
      className={`rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="text-sm text-red-700">
      {children}
    </p>
  ) : null;
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
    {children}
  </p>
);

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];
export function timeAgo(ts: number, now = Date.now()) {
  const diff = ts - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export type Automation = {
  eventType: "request_notification" | "overdue_reminder";
  status: "sent" | "failed";
  summary: string;
  createdAt: number;
};

export function AutomationActivity({ recent, fallback }: { recent: Automation[]; fallback?: string }) {
  const lines = recent.map((a) => {
    const what = a.eventType === "overdue_reminder" ? "Reminder" : "Notification";
    return `${what} ${a.status} ${timeAgo(a.createdAt)}`;
  });
  return (
    <div className="mt-2 text-xs text-zinc-500">
      <span className="font-medium">Recent automation activity: </span>
      {lines.length ? lines.join(" · ") : fallback || "No automation activity yet"}
    </div>
  );
}
