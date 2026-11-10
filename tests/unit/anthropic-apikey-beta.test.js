import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";

// Console API keys answer `claude-code-20250219` with a fake "credit balance too low" 400.
describe("anthropic API-key provider strips the subscription-only beta", () => {
  const ex = new DefaultExecutor("anthropic");
  const beta = (h) => h["Anthropic-Beta"] ?? h["anthropic-beta"];

  it("drops it from the provider default header", () => {
    const h = ex.buildHeaders({ apiKey: "k" }, true, "u", "claude-opus-5-5");
    expect(beta(h)).not.toContain("claude-code-20250219");
    expect(beta(h)).toContain("interleaved-thinking-2025-05-14");
  });

  it("drops it when the client (Claude Code) forwards it", () => {
    const h = ex.buildHeaders(
      { apiKey: "k", rawHeaders: { "anthropic-beta": "claude-code-20250219,context-1m-2025-08-07" } },
      true, "u", "claude-opus-5-5");
    expect(beta(h)).not.toContain("claude-code-20250219");
    expect(beta(h)).toContain("context-1m-2025-08-07");
  });

  it("leaves the subscription (claude) provider alone", () => {
    const h = new DefaultExecutor("claude").buildHeaders({ accessToken: "sk-ant-oat-x" }, true, "u", "claude-opus-5-5");
    expect(beta(h)).toContain("claude-code-20250219");
  });
});
