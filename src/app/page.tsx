"use client";

import Link from "next/link";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { api } from "../../convex/_generated/api";
import { Empty, catLabel } from "./shared";

function PublicTools() {
  const tools = useQuery(api.tools.listPublicAvailableTools);
  if (tools === undefined) return <p className="text-sm text-zinc-500">Loading tools…</p>;
  if (tools.length === 0) return <Empty>No tools are available right now. Check back soon.</Empty>;
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Available tools</caption>
        <thead className="bg-zinc-100 text-zinc-600">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Tool</th>
            <th scope="col" className="px-4 py-2 font-medium">Category</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((t) => (
            <tr key={t._id} className="border-t border-zinc-200">
              <td className="px-4 py-2">{t.name}</td>
              <td className="px-4 py-2">{catLabel(t.category)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-10 flex items-start justify-between gap-4">
        <span className="text-xl font-bold text-teal-700">LendLoop</span>
        <Authenticated>
          <UserButton />
        </Authenticated>
      </div>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Borrow what you need. Lend what you don&apos;t.
      </h1>
      <div className="my-6">
        <Unauthenticated>
          <SignInButton mode="modal">
            <button
              type="button"
              className="rounded-md bg-teal-700 px-5 py-3 font-medium text-white hover:bg-teal-800"
            >
              Sign in to lend or borrow
            </button>
          </SignInButton>
        </Unauthenticated>
        <Authenticated>
          <Link
            href="/dashboard"
            className="inline-block rounded-md bg-teal-700 px-5 py-3 font-medium text-white hover:bg-teal-800"
          >
            Open dashboard
          </Link>
        </Authenticated>
      </div>
      <h2 className="mb-3 text-lg font-semibold">Available tools</h2>
      <PublicTools />
    </main>
  );
}
