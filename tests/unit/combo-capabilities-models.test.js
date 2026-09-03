import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("combo model metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("advertises configured context and input capabilities", async () => {
    const caps = {
      contextWindow: 128000,
      vision: true,
      pdf: true,
      audioInput: false,
      videoInput: false,
    };
    mocks.getCombos.mockResolvedValue([{ name: "mixed", kind: null, models: ["p/model"], caps }]);

    const model = (await buildModelsList(["llm"])).find((entry) => entry.id === "mixed");

    expect(model).toMatchObject({
      owned_by: "combo",
      context_length: 128000,
      capabilities: caps,
    });
  });

  it("keeps legacy combos backward compatible", async () => {
    mocks.getCombos.mockResolvedValue([{ name: "legacy", kind: null, models: ["p/model"] }]);

    const model = (await buildModelsList(["llm"])).find((entry) => entry.id === "legacy");

    expect(model).toEqual({ id: "legacy", object: "model", owned_by: "combo" });
  });
});
