import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCombo: vi.fn(),
  getComboByName: vi.fn(),
  getCombos: vi.fn(),
}));

vi.mock("@/lib/localDb", () => mocks);

const { POST } = await import("../../src/app/api/combos/route.js");

describe("POST /api/combos capability metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getComboByName.mockResolvedValue(null);
    mocks.createCombo.mockImplementation(async (value) => ({ id: "combo-id", ...value }));
  });

  it("persists configured context and input capabilities", async () => {
    const caps = {
      contextWindow: 128000,
      vision: true,
      pdf: false,
      audioInput: false,
      videoInput: false,
    };
    const response = await POST(new Request("https://router.test/api/combos", {
      method: "POST",
      body: JSON.stringify({ name: "mixed", models: ["p/model"], caps }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createCombo).toHaveBeenCalledWith({
      name: "mixed",
      models: ["p/model"],
      kind: null,
      caps,
    });
  });

  it("rejects invalid capability metadata", async () => {
    const response = await POST(new Request("https://router.test/api/combos", {
      method: "POST",
      body: JSON.stringify({ name: "bad", models: ["p/model"], caps: { contextWindow: 0, vision: "yes" } }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.createCombo).not.toHaveBeenCalled();
  });
});
