"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge, Button, CATEGORIES, Empty, ErrorText, catLabel, condLabel, errMsg, inputCls } from "../shared";

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

function BorrowDialog({
  tool,
  onClose,
}: {
  tool: { _id: Id<"tools">; name: string };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const request = useMutation(api.loans.requestLoan);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setRef = (el: HTMLDialogElement | null) => {
    ref.current = el;
    if (el && !el.open) el.showModal();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (end < start) return setError("End date must be on or after the start date.");
    setBusy(true);
    setError("");
    try {
      await request({ toolId: tool._id, startDate: start, endDate: end });
      onClose();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={setRef}
      onClose={onClose}
      aria-labelledby="borrow-title"
      className="m-auto w-[min(92vw,24rem)] rounded-lg p-0 backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <h2 id="borrow-title" className="text-lg font-semibold">Borrow: {tool.name}</h2>
        <div>
          <label htmlFor="b-start" className="mb-1 block text-sm font-medium">Start date</label>
          <input id="b-start" type="date" required min={today()} value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="b-end" className="mb-1 block text-sm font-medium">End date</label>
          <input id="b-end" type="date" required min={start || today()} value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => ref.current?.close()}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send request"}</Button>
        </div>
      </form>
    </dialog>
  );
}

export default function BrowseTab() {
  const tools = useQuery(api.tools.listBrowseTools);
  const [filter, setFilter] = useState<string>("all");
  const [target, setTarget] = useState<{ _id: Id<"tools">; name: string } | null>(null);

  if (tools === undefined) return <p className="text-sm text-zinc-500">Loading tools…</p>;
  const shown = filter === "all" ? tools : tools.filter((t) => t.category === filter);
  const pills: [string, string][] = [["all", "All"], ...Object.entries(CATEGORIES)];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {pills.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === id ? "border-teal-700 bg-teal-700 text-white" : "border-zinc-300 bg-white hover:bg-zinc-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty>No tools match.</Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {shown.map((t) => (
            <li key={t._id} className="flex flex-col rounded-lg border border-zinc-200 bg-white p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="font-semibold">{t.name}</h3>
                <Badge tone={t.isAvailable ? "green" : "gray"}>{t.isAvailable ? "Available" : "Unavailable"}</Badge>
              </div>
              <p className="text-sm text-zinc-500">{catLabel(t.category)} · {condLabel(t.condition)}</p>
              <p className="my-2 flex-1 text-sm">{t.description}</p>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                Owner: {t.ownerDisplayName}
                {t.ownerTrusted && <Badge tone="accent">Trusted Lender</Badge>}
              </p>
              {!t.isMine && t.isAvailable && (
                <Button onClick={() => setTarget({ _id: t._id, name: t.name })}>Request to Borrow</Button>
              )}
              {t.isMine && <p className="text-xs text-zinc-500">Your listing</p>}
            </li>
          ))}
        </ul>
      )}
      {target && <BorrowDialog key={target._id} tool={target} onClose={() => setTarget(null)} />}
    </div>
  );
}
