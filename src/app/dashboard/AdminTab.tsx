"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Badge, Button, ErrorText, StatusBadge, catLabel, errMsg } from "../shared";

const th = "px-3 py-2 font-medium";
const td = "px-3 py-2";
const Wrap = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-8">
    <h2 className="mb-2 text-lg font-semibold">{title}</h2>
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">{children}</div>
  </section>
);
const Msg = ({ cols, children }: { cols: number; children: React.ReactNode }) => (
  <tr><td className={td} colSpan={cols}>{children}</td></tr>
);

export default function AdminTab() {
  const loans = useQuery(api.admin.listAllLoans);
  const tools = useQuery(api.tools.listBrowseTools);
  const lenders = useQuery(api.admin.listLenders);
  const del = useMutation(api.tools.deleteTool);
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setError("");
    setPending(key);
    try {
      await fn();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <ErrorText>{error}</ErrorText>
      <Wrap title="All loans">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-100 text-zinc-600">
            <tr>
              <th className={th}>Tool</th><th className={th}>Owner</th><th className={th}>Borrower</th>
              <th className={th}>Dates</th><th className={th}>Status</th><th className={th}>Automation</th>
            </tr>
          </thead>
          <tbody>
            {loans === undefined ? <Msg cols={6}>Loading…</Msg> : loans.length === 0 ? <Msg cols={6}>No loans.</Msg> :
              loans.map((l) => (
                <tr key={l._id} className="border-t border-zinc-200">
                  <td className={td}>{l.toolName}</td><td className={td}>{l.ownerName}</td><td className={td}>{l.borrowerName}</td>
                  <td className={td}>{l.startDate} to {l.endDate}</td><td className={td}><StatusBadge status={l.status} /></td>
                  <td className={td}>{l.lastAutomationSummary ?? "None"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Wrap>
      <Wrap title="All listings">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-100 text-zinc-600">
            <tr>
              <th className={th}>Tool</th><th className={th}>Category</th><th className={th}>Owner</th>
              <th className={th}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {tools === undefined ? <Msg cols={4}>Loading…</Msg> : tools.length === 0 ? <Msg cols={4}>No listings.</Msg> :
              tools.map((t) => (
                <tr key={t._id} className="border-t border-zinc-200">
                  <td className={td}>{t.name}</td><td className={td}>{catLabel(t.category)}</td><td className={td}>{t.ownerDisplayName}</td>
                  <td className={td}>
                    <Button variant="danger" disabled={pending === t._id} onClick={() => confirm(`Remove "${t.name}"?`) && run(t._id, () => del({ toolId: t._id }))}>Remove</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Wrap>
      <Wrap title="Lenders">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-100 text-zinc-600">
            <tr><th className={th}>Name</th><th className={th}>Role</th><th className={th}>Tools</th><th className={th}>Trusted</th></tr>
          </thead>
          <tbody>
            {lenders === undefined ? <Msg cols={4}>Loading…</Msg> : lenders.length === 0 ? <Msg cols={4}>No lenders.</Msg> :
              lenders.map((u) => (
                <tr key={u._id} className="border-t border-zinc-200">
                  <td className={td}>{u.displayName}</td><td className={td}>{u.role}</td><td className={td}>{u.toolCount}</td>
                  <td className={td}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={u.trustedLender}
                        disabled={pending === u._id}
                        onChange={(e) => run(u._id, () => setTrusted({ userId: u._id, trusted: e.target.checked }))}
                      />
                      {u.trustedLender ? <Badge tone="accent">Trusted Lender</Badge> : <span className="text-zinc-500">Not trusted</span>}
                    </label>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Wrap>
    </div>
  );
}
