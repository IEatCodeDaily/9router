// Production-only opt-in: REQUEST_DETAILS_SHOW_BODIES=1 returns stored request
// bodies, but only while dashboard login is enforced. With requireLogin off the
// dashboard guard lets anyone through, so redaction must stay on regardless.

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getRequestDetails: vi.fn(), getSettings: vi.fn() }));
vi.mock("@/lib/usageDb", () => ({ getRequestDetails: mocks.getRequestDetails }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

const { GET } = await import("../../src/app/api/usage/request-details/route.js");

const ROW = { id: "r1", model: "m", request: { messages: ["secret prompt"] }, response: { content: "reply" } };

async function fetchRow({ flag, requireLogin }) {
  if (flag === undefined) delete process.env.REQUEST_DETAILS_SHOW_BODIES;
  else process.env.REQUEST_DETAILS_SHOW_BODIES = flag;
  mocks.getSettings.mockResolvedValue({ requireLogin });
  mocks.getRequestDetails.mockResolvedValue({ details: [structuredClone(ROW)], total: 1 });
  const res = await GET(new Request("http://x/api/usage/request-details?page=1&pageSize=20"));
  return (await res.json()).details[0];
}

afterEach(() => delete process.env.REQUEST_DETAILS_SHOW_BODIES);

describe("request-details body visibility", () => {
  it("redacts by default", async () => {
    expect((await fetchRow({ requireLogin: true })).request).toEqual({ redacted: true });
  });

  it("shows bodies when the flag is on and login is enforced", async () => {
    const row = await fetchRow({ flag: "1", requireLogin: true });
    expect(row.request).toEqual(ROW.request);
    expect(row.response).toEqual(ROW.response);
  });

  it("stays redacted when login is disabled, even with the flag on", async () => {
    expect((await fetchRow({ flag: "1", requireLogin: false })).request).toEqual({ redacted: true });
  });

  it("only accepts the exact value 1", async () => {
    expect((await fetchRow({ flag: "true", requireLogin: true })).request).toEqual({ redacted: true });
  });

  it("keeps metadata either way", async () => {
    expect((await fetchRow({ requireLogin: true })).model).toBe("m");
  });
});
