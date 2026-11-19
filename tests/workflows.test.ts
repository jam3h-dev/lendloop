/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import raw01 from "../n8n/workflows/01-request-notification.json?raw";
import raw02 from "../n8n/workflows/02-overdue-reminders.json?raw";
import raw03 from "../n8n/workflows/03-error-handler.json?raw";

type Node = { name: string; type: string; retryOnFail?: boolean; maxTries?: number; waitBetweenTries?: number; parameters: { url?: string } };
type Workflow = { id: string; nodes: Node[]; settings: { errorWorkflow?: string } };

const files = { "01": raw01, "02": raw02, "03": raw03 };
const wf = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, JSON.parse(v) as Workflow]));

describe("exported n8n workflows", () => {
  it.each(Object.entries(files))("%s contains no hardcoded secrets", (_, raw) => {
    expect(raw).not.toMatch(/[a-f0-9]{40,}/i); // hex secrets / signatures
    expect(raw).not.toMatch(/\b(sk|pk)_(test|live)_/); // Clerk-style keys
    expect(raw).not.toMatch(/https?:\/\/[^"]*\.convex\.(site|cloud)/); // deployment URLs
    expect(raw).not.toMatch(/Bearer\s+\w/);
  });

  it("read the secret and Convex URL from $env only", () => {
    expect(raw01).toContain("$env.N8N_WEBHOOK_SECRET");
    expect(raw02).toContain("$env.N8N_WEBHOOK_SECRET");
    expect(raw01).toContain("$env.CONVEX_HTTP_BASE_URL");
    expect(raw02).toContain("$env.CONVEX_HTTP_BASE_URL");
  });

  it("01 and 02 are linked to the error workflow", () => {
    expect(wf["01"].settings.errorWorkflow).toBe(wf["03"].id);
    expect(wf["02"].settings.errorWorkflow).toBe(wf["03"].id);
    expect(wf["03"].nodes.some((n) => n.type === "n8n-nodes-base.errorTrigger")).toBe(true);
  });

  it("every call to Convex retries 3 times, 2s apart", () => {
    const convexCalls = [...wf["01"].nodes, ...wf["02"].nodes].filter((n) =>
      n.parameters.url?.includes("CONVEX_HTTP_BASE_URL"),
    );
    expect(convexCalls.length).toBe(3); // 01 write-back, 02 fetch + write-back
    for (const n of convexCalls) {
      expect(n).toMatchObject({ retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });
    }
  });

  it("write-backs carry the documented idempotency keys", () => {
    expect(raw01).toContain("'notif:' + p.eventId");
    expect(raw02).toContain("'overdue:' + r.loanId + ':' + date");
  });
});
