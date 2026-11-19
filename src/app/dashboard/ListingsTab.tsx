"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
  Badge, Button, CATEGORIES, CONDITIONS, Empty, ErrorText, catLabel, condLabel, errMsg, inputCls,
  type Category, type Condition,
} from "../shared";

type Draft = { name: string; category: Category; condition: Condition; description: string };
const blank: Draft = { name: "", category: "other", condition: "good", description: "" };

const toDraft = (t: Doc<"tools">): Draft => ({
  name: t.name, category: t.category, condition: t.condition, description: t.description,
});

function ToolFields({ idp, v, set }: { idp: string; v: Draft; set: (d: Draft) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idp}-name`} className="mb-1 block text-sm font-medium">Name</label>
        <input id={`${idp}-name`} required value={v.name} onChange={(e) => set({ ...v, name: e.target.value })} className={inputCls} />
      </div>
      <div>
        <label htmlFor={`${idp}-cat`} className="mb-1 block text-sm font-medium">Category</label>
        <select id={`${idp}-cat`} value={v.category} onChange={(e) => set({ ...v, category: e.target.value as Category })} className={inputCls}>
          {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idp}-cond`} className="mb-1 block text-sm font-medium">Condition</label>
        <select id={`${idp}-cond`} value={v.condition} onChange={(e) => set({ ...v, condition: e.target.value as Condition })} className={inputCls}>
          {Object.entries(CONDITIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${idp}-desc`} className="mb-1 block text-sm font-medium">Description</label>
        <textarea id={`${idp}-desc`} required rows={3} value={v.description} onChange={(e) => set({ ...v, description: e.target.value })} className={inputCls} />
      </div>
    </div>
  );
}

function CreateForm() {
  const create = useMutation(api.tools.createTool);
  const [d, setD] = useState<Draft>(blank);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await create(d);
      setD(blank);
    } catch (err) {
      setError(errMsg(err));
    }
  }
  return (
    <form onSubmit={submit} className="mb-6 space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="font-semibold">List a new tool</h2>
      <ToolFields idp="new" v={d} set={setD} />
      <ErrorText>{error}</ErrorText>
      <Button type="submit">Add listing</Button>
    </form>
  );
}

function Row({ tool }: { tool: Doc<"tools"> }) {
  const update = useMutation(api.tools.updateTool);
  const del = useMutation(api.tools.deleteTool);
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Draft>(toDraft(tool));
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>, done?: () => void) {
    setError("");
    try {
      await fn();
      done?.();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => update({ toolId: tool._id, ...d }), () => setEditing(false));
          }}
          className="space-y-3"
        >
          <ToolFields idp={tool._id} v={d} set={setD} />
          <div className="flex gap-2">
            <Button type="submit">Save</Button>
            <Button variant="secondary" onClick={() => { setD(toDraft(tool)); setEditing(false); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="mb-1 flex items-start justify-between gap-2">
            <h3 className="font-semibold">{tool.name}</h3>
            <Badge tone={tool.isAvailable ? "green" : "gray"}>{tool.isAvailable ? "Available" : "Unavailable"}</Badge>
          </div>
          <p className="text-sm text-zinc-500">{catLabel(tool.category)} · {condLabel(tool.condition)}</p>
          <p className="my-2 text-sm">{tool.description}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { setD(toDraft(tool)); setEditing(true); }}>Edit</Button>
            <Button variant="secondary" onClick={() => run(() => update({ toolId: tool._id, isAvailable: !tool.isAvailable }))}>
              Mark {tool.isAvailable ? "unavailable" : "available"}
            </Button>
            <Button variant="danger" onClick={() => confirm(`Delete "${tool.name}"?`) && run(() => del({ toolId: tool._id }))}>Delete</Button>
          </div>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </li>
  );
}

export default function ListingsTab() {
  const tools = useQuery(api.tools.listMyTools);
  return (
    <div>
      <CreateForm />
      {tools === undefined ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : tools.length === 0 ? (
        <Empty>You have not listed any tools yet.</Empty>
      ) : (
        <ul className="space-y-3">{tools.map((t) => <Row key={t._id} tool={t} />)}</ul>
      )}
    </div>
  );
}
