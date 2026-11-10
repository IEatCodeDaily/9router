import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { getUsageAttribution } from "@/lib/usageAttribution.js";

let adapter;
let directory;
let repo;
let usage;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "usage-insights-"));
  process.env.DATA_DIR = directory;
  delete global._dbAdapter;
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  repo = await import("@/lib/db/repos/usageInsightsRepo.js");
  usage = await import("@/lib/db/repos/usageRepo.js");
});
afterAll(() => {
  adapter?.close?.();
  delete process.env.DATA_DIR;
  fs.rmSync(directory, { recursive: true, force: true });
});

it("keeps historical quota windows and separates sessions and authenticated owners without leaking keys", async () => {
  const timestamp = "2026-11-01T01:00:00.000Z";
  const connection = { id: "subscription", provider: "claude", name: "Work subscription" };
  const quota = (used, resetAt) => ({ plan: "Pro", accessToken: "must-not-persist", quotas: { weekly: { used, total: 100, resetAt } } });
  await repo.saveQuotaSnapshot(connection, quota(80, "2026-11-02T00:00:00Z"), timestamp);
  await repo.saveQuotaSnapshot(connection, quota(80, "2026-11-02T00:00:00Z"), timestamp);
  await repo.saveQuotaSnapshot(connection, quota(2, "2026-11-09T00:00:00Z"), "2026-11-02T01:00:00Z");
  await repo.saveQuotaSnapshot(connection, { message: "unavailable" });
  adapter.run("INSERT INTO apiKeys(id, key, name, createdAt) VALUES (?, ?, ?, ?)", ["alice", "private-key-a", "Alice", timestamp]);
  for (const [sessionId, apiKey, prompt] of [["one", "private-key-a", 20], ["two", "private-key-a", 20], ["one", "private-key-b", 40], [null, null, 10]]) {
    await usage.saveRequestUsage({ timestamp, provider: "claude", model: "sonnet", connectionId: connection.id,
      apiKey, tokens: { prompt_tokens: prompt, completion_tokens: 5, cached_tokens: 3 }, meta: { sessionId } });
  }
  const result = await repo.getUsageInsights({ start: "2026-11-01", end: "2026-11-03", connectionId: connection.id });
  expect(result.totals).toMatchObject({ requests: 4, promptTokens: 90, completionTokens: 20, cachedTokens: 12, unattributedRequests: 1 });
  expect(result.sessions).toHaveLength(4);
  expect(result.owners.find((row) => row.ownerId === "alice")).toMatchObject({ requests: 2, promptTokens: 40, ownerName: "Alice" });
  expect(result.quotaCount).toBe(2);
  expect(result.quotaHistory.map((row) => row.quotas.weekly.used)).toEqual([80, 2]);
  expect(JSON.stringify(result)).not.toMatch(/private-key|must-not-persist/);
  adapter.run("DELETE FROM apiKeys WHERE id = ?", ["alice"]);
  const afterDeletion = await repo.getUsageInsights({ start: "2026-11-01", end: "2026-11-03" });
  expect(afterDeletion.owners.find((row) => row.ownerId === "alice").ownerName).toBe("Alice");
  adapter.run("INSERT INTO usageHistory(timestamp, connectionId, provider, tokens, meta) VALUES(?, ?, ?, ?, ?)", [timestamp, "unsupported", "openai", "{}", "{}"]);
  const inventory = await repo.getUsageInsights({ start: "2026-11-01", end: "2026-11-03" });
  expect(inventory.accounts.some((row) => row.connectionId === "unsupported" && !row.timestamp)).toBe(true);
  expect(adapter.all("EXPLAIN QUERY PLAN SELECT * FROM usageHistory WHERE connectionId = ? AND timestamp >= ? AND timestamp <= ?", ["subscription", timestamp, timestamp]).some((row) => row.detail.includes("idx_uh_conn_ts"))).toBe(true);
});

it("uses only explicit session identifiers and validates date ranges", () => {
  expect(getUsageAttribution(null).sessionId).toBeNull();
  expect(getUsageAttribution({ headers: { "x-client-request-id": "one-request" }, body: {} }).sessionId).toBeNull();
  expect(getUsageAttribution({ body: { messages: [{ role: "assistant", content: "x".repeat(100) }] } }).sessionId).toBeNull();
  expect(getUsageAttribution({ headers: new Headers({ "X-Session-Id": "t3-thread" }), body: { user: "self-reported" } })).toMatchObject({ sessionId: "t3-thread", clientUser: "self-reported" });
  expect(getUsageAttribution({ body: { metadata: { user_id: '{"session_id":"hermes-session"}' } } }).sessionId).toBe("claude:hermes-session");
  expect(() => repo.parseInsightsRange(new URLSearchParams("start=2020-01-01&end=2026-01-01"))).toThrow("93 days");
  expect(() => repo.parseInsightsRange(new URLSearchParams("start=invalid"))).toThrow("Invalid date range");
  expect(() => repo.parseInsightsRange(new URLSearchParams("start=2026-12-01&end=2026-01-01"))).toThrow();
});
