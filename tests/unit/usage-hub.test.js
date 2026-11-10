import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, expect, it, vi } from "vitest";

let hasUsageHubAccess, listUsageHubAccounts, readUsageHubCall, toUsageHubPayload, GET, POST;
let adapter;
let directory;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "usage-hub-"));
  process.env.DATA_DIR = directory;
  delete global._dbAdapter;
  vi.resetModules();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  ({ hasUsageHubAccess, listUsageHubAccounts, readUsageHubCall, toUsageHubPayload } = await import("@/lib/usageHub.js"));
  ({ GET } = await import("@/app/v0/management/auth-files/route.js"));
  ({ POST } = await import("@/app/v0/management/api-call/route.js"));
});
afterAll(() => {
  adapter?.close?.();
  delete process.env.DATA_DIR;
  delete process.env.NINEROUTER_USAGE_MANAGEMENT_KEY;
  fs.rmSync(directory, { recursive: true, force: true });
});

it("fails closed without a dedicated key, independently of dashboard or inference auth", async () => {
  const request = new Request("http://localhost/v0/management/auth-files");
  delete process.env.NINEROUTER_USAGE_MANAGEMENT_KEY;
  expect(hasUsageHubAccess(request)).toBe(false);
  expect((await GET(request)).status).toBe(401);
  process.env.NINEROUTER_USAGE_MANAGEMENT_KEY = "management-only-key";
  expect(hasUsageHubAccess(new Request(request, { headers: { authorization: "management-only-key" } }))).toBe(false);
  expect(hasUsageHubAccess(new Request(request, { headers: { authorization: "Bearer inference-key" } }))).toBe(false);
  expect(hasUsageHubAccess(new Request(request, { headers: { authorization: "Bearer management-only-key" } }))).toBe(true);
});

it("serves the CLIProxyAPI string envelope without forwarding arbitrary URLs, tokens or reset mutations", async () => {
  const now = new Date().toISOString();
  adapter.run("INSERT INTO providerConnections(id, provider, authType, email, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
    ["c1", "codex", "oauth", "owner@example.test", 1, JSON.stringify({ accessToken: "never-export-this" }), now, now]);
  adapter.run("INSERT INTO quotaHistory(timestamp, connectionId, provider, data) VALUES(?, ?, ?, ?)", [now, "c1", "codex", JSON.stringify({ plan: "pro", quotas: { session: { used: 35, total: 100, resetAt: "2026-12-01T00:00:00Z" } } })]);
  const files = await listUsageHubAccounts();
  expect(files).toEqual([{ id: "c1", auth_index: "c1", provider: "codex", email: "owner@example.test", disabled: false }]);
  const body = { auth_index: "c1", method: "GET", url: "https://chatgpt.com/backend-api/wham/usage" };
  const result = await readUsageHubCall(body);
  expect(result.status_code).toBe(200);
  expect(typeof result.body).toBe("string");
  expect(JSON.parse(result.body)).toMatchObject({ plan_type: "pro", rate_limit: { primary_window: { used_percent: 35 } } });
  expect(JSON.stringify(files) + JSON.stringify(result)).not.toContain("never-export-this");
  expect((await readUsageHubCall({ ...body, url: "http://169.254.169.254/latest/meta-data" })).status_code).toBe(403);
  expect((await readUsageHubCall({ ...body, method: "POST" })).status_code).toBe(400);
  const request = new Request("http://localhost/v0/management/api-call", { method: "POST", headers: { authorization: "Bearer management-only-key" }, body: JSON.stringify(body) });
  expect(await (await POST(request)).json()).toEqual(result);
  expect((await POST(new Request(request.url, { method: "POST", headers: request.headers, body: "{" }))).status).toBe(400);
  adapter.run("UPDATE quotaHistory SET timestamp = ?", ["2020-01-01T00:00:00Z"]);
  expect((await readUsageHubCall(body)).status_code).toBe(503);
});

it("maps genuine Claude quotas, omitting unknown windows rather than inventing zero usage", () => {
  expect(toUsageHubPayload("claude", { quotas: {} })).toBeNull();
  expect(toUsageHubPayload("claude", { quotas: {
    "session (5h)": { used: 75, total: 100, resetAt: "2026-12-01T00:00:00Z" },
    "weekly fable (7d)": { used: 50, total: 100 },
  } })).toMatchObject({ five_hour: { utilization: 75 }, seven_day: null, limits: [{ kind: "weekly_scoped", percent: 50, scope: { model: { display_name: "fable" } } }] });
});

it("passes the real Codex window length through so a weekly-only plan is not labelled a session", () => {
  const resetAt = "2099-01-01T00:00:00Z";
  // prolite reports only a primary window, and it is the 7-day one.
  expect(toUsageHubPayload("codex", { plan: "prolite", quotas: { session: { used: 74, total: 100, resetAt, windowSeconds: 604800 } } }))
    .toMatchObject({ rate_limit: { primary_window: { used_percent: 74, limit_window_seconds: 604800 } } });
  // Older snapshots without a recorded length keep the positional default.
  expect(toUsageHubPayload("codex", { quotas: { session: { used: 1, total: 100, resetAt } } }).rate_limit.primary_window.limit_window_seconds).toBe(18000);
});
