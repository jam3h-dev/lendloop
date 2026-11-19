"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AutomationActivity, Button, Empty, ErrorText, StatusBadge, errMsg } from "../shared";

type Req = NonNullable<ReturnType<typeof useQuery<typeof api.loans.listMyRequests>>>[number];

function Card({ r, who, actions }: { r: Req; who: string; actions?: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{r.toolName}</h3>
        <StatusBadge status={r.status} />
      </div>
      <p className="text-sm text-zinc-600">{who}: {r.counterpartName}</p>
      <p className="text-sm text-zinc-600">{r.startDate} to {r.endDate}</p>
      <AutomationActivity recent={r.recentAutomation} fallback={r.lastAutomationSummary} />
      {actions}
    </li>
  );
}

function List({ rows, who, actions }: { rows: Req[] | undefined; who: string; actions?: (r: Req) => React.ReactNode }) {
  if (rows === undefined) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (rows.length === 0) return <Empty>No requests yet.</Empty>;
  return <ul className="space-y-3">{rows.map((r) => <Card key={r._id} r={r} who={who} actions={actions?.(r)} />)}</ul>;
}

export function MyRequestsTab() {
  return <List rows={useQuery(api.loans.listMyRequests)} who="Owner" />;
}

export function IncomingTab() {
  const rows = useQuery(api.loans.listIncomingRequests);
  const update = useMutation(api.loans.updateLoanStatus);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);

  async function set(loanId: Id<"loans">, status: "approved" | "declined" | "returned") {
    setError(null);
    try {
      await update({ loanId, status });
    } catch (err) {
      setError({ id: loanId, msg: errMsg(err) });
    }
  }

  return (
    <List
      rows={rows}
      who="Borrower"
      actions={(r) => (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            {r.status === "pending" && (
              <>
                <Button onClick={() => set(r._id, "approved")}>Approve</Button>
                <Button variant="secondary" onClick={() => set(r._id, "declined")}>Decline</Button>
              </>
            )}
            {r.status === "approved" && <Button onClick={() => set(r._id, "returned")}>Mark returned</Button>}
          </div>
          {error?.id === r._id && <ErrorText>{error.msg}</ErrorText>}
        </div>
      )}
    />
  );
}
