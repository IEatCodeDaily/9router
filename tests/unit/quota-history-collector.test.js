import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connections: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: mocks.connections }));
vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({ GET: mocks.read }));

it("polls eligible accounts without LLM calls, continues after failure, and records health", async () => {
  delete global.__quotaHistory;
  mocks.connections.mockResolvedValue([
    { id: "off", provider: "claude", authType: "oauth", isActive: false },
    { id: "unsupported-key", provider: "openai", authType: "apikey" },
    { id: "one", provider: "codex", authType: "oauth", isActive: true },
    { id: "two", provider: "claude", authType: "oauth", isActive: true },
  ]);
  mocks.read.mockRejectedValueOnce(new Error("provider unavailable"));
  mocks.read.mockResolvedValueOnce(Response.json({ quotas: {}, recordedAt: new Date().toISOString() }));
  const { collectQuotaHistory, getQuotaCollectorStatus } = await import("@/shared/services/quotaHistory.js");
  await collectQuotaHistory();
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(getQuotaCollectorStatus()).toMatchObject({ running: false, intervalSeconds: 300 });
  expect(getQuotaCollectorStatus().lastErrorAt).toBeTruthy();
  expect(getQuotaCollectorStatus().lastPollAt).toBeTruthy();
});

it("continues past a shared provider promise that never settles", async () => {
  const controller = new AbortController();
  const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  mocks.read.mockReset();
  mocks.connections.mockResolvedValue([
    { id: "hung", provider: "claude", authType: "oauth" },
    { id: "healthy", provider: "codex", authType: "oauth" },
  ]);
  mocks.read.mockImplementationOnce(() => new Promise(() => {}));
  mocks.read.mockResolvedValueOnce(Response.json({ recordedAt: new Date().toISOString() }));
  const { collectQuotaHistory, getQuotaCollectorStatus } = await import("@/shared/services/quotaHistory.js");
  const timer = setTimeout(() => controller.abort(new Error("Deadline")), 20);
  try {
    await collectQuotaHistory();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(getQuotaCollectorStatus().running).toBe(false);
  } finally { clearTimeout(timer); deadline.mockRestore(); }
});
