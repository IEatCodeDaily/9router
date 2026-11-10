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

  it("publishes the Codex Sol default for the route and its single-member combo", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ provider: "codex", isActive: true }]);
    mocks.getCombos.mockResolvedValue([{ name: "gpt", models: ["cx/gpt-6.1-sol"] }]);

    const models = await buildModelsList(["llm"]);
    for (const id of ["gpt", "cx/gpt-6.1-sol"]) {
      expect(models.find((entry) => entry.id === id)).toMatchObject({
        context_length: 500000,
        max_completion_tokens: 128000,
        capabilities: { contextWindow: 500000 },
      });
    }
  });

  it("keeps smaller members and explicit combo context overrides", async () => {
    mocks.getCombos.mockResolvedValue([
      { name: "mixed", models: ["cx/gpt-6.1-sol", "cx/gpt-6-sol"] },
      { name: "capped", models: ["cx/gpt-6.1-sol"], caps: { contextWindow: 128000 } },
    ]);

    const models = await buildModelsList(["llm"]);
    expect(models.find((entry) => entry.id === "mixed").context_length).toBe(272000);
    expect(models.find((entry) => entry.id === "capped").context_length).toBe(128000);
  });

  it("keeps legacy combos backward compatible", async () => {
    mocks.getCombos.mockResolvedValue([{ name: "legacy", kind: null, models: ["p/model"] }]);

    const model = (await buildModelsList(["llm"])).find((entry) => entry.id === "legacy");

    // A combo stored before the caps column exists must still be listed. Since
    // v0.5.95 upstream derives context_length from member windows (pattern
    // default here), so assert listing + a derived limit, not absence.
    expect(model).toMatchObject({ id: "legacy", object: "model", owned_by: "combo" });
    expect(Number.isSafeInteger(model.context_length) && model.context_length > 0).toBe(true);
  });
});
