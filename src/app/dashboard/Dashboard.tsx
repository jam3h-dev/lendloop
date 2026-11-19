"use client";

import { useEffect, useState } from "react";
import { AuthLoading, Authenticated, Unauthenticated, useConvexAuth, useMutation, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import { Badge } from "../shared";
import BrowseTab from "./BrowseTab";
import ListingsTab from "./ListingsTab";
import { MyRequestsTab, IncomingTab } from "./RequestsTabs";
import AdminTab from "./AdminTab";

type TabId = "browse" | "listings" | "requests" | "incoming" | "admin";

function Inner() {
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  const [stored, setStored] = useState(false);
  useEffect(() => {
    if (isAuthenticated && !stored) store({}).then(() => setStored(true), () => setStored(true));
  }, [isAuthenticated, stored, store]);
  const me = useQuery(api.users.me, stored ? {} : "skip");
  const [tab, setTab] = useState<TabId>("browse");

  const tabs: [TabId, string][] = [
    ["browse", "Browse Tools"],
    ["listings", "My Listings"],
    ["requests", "My Requests"],
    ["incoming", "Incoming Requests"],
    ...(me?.role === "admin" ? ([["admin", "Admin Panel"]] as [TabId, string][]) : []),
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-xl font-bold text-teal-700">LendLoop</Link>
        <div className="flex items-center gap-3">
          {me && <span className="text-sm font-medium">{me.displayName}</span>}
          {me?.trustedLender && <Badge tone="accent">Trusted Lender</Badge>}
          <UserButton />
        </div>
      </header>
      <div role="tablist" aria-label="Dashboard sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-200">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              tab === id ? "border-teal-700 text-teal-700" : "border-transparent text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {!me ? (
        <p className="text-sm text-zinc-500">Loading your account…</p>
      ) : (
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "browse" && <BrowseTab />}
          {tab === "listings" && <ListingsTab />}
          {tab === "requests" && <MyRequestsTab />}
          {tab === "incoming" && <IncomingTab />}
          {tab === "admin" && me.role === "admin" && <AdminTab />}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <>
      <AuthLoading><p className="p-6 text-sm text-zinc-500">Loading…</p></AuthLoading>
      <Unauthenticated>
        <p className="p-6 text-sm">Please <Link className="underline" href="/">sign in</Link>.</p>
      </Unauthenticated>
      <Authenticated><Inner /></Authenticated>
    </>
  );
}
