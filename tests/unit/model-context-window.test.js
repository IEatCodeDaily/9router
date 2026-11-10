// Context-window formatting for the models UI.
//
// Regression guard: `contextWindow` shipped in the caps payload that
// /api/models serves, but CapacityBadges filtered caps down to boolean flags,
// so every model row silently dropped it.
//
// SCOPE: this repo's vitest harness is `environment: "node"` with no React
// plugin, and the components keep JSX in `.js` files — so component rendering
// cannot be tested here. This covers the pure formatter only; the wiring in
// CapacityBadges is verified against the running UI instead.

import { describe, it, expect } from "vitest";
import { formatContextWindow } from "@/shared/constants/models.js";

describe("formatContextWindow", () => {
  it("renders sub-million windows in k", () => {
    expect(formatContextWindow(272000)).toBe("272k");
    expect(formatContextWindow(128000)).toBe("128k");
    expect(formatContextWindow(8192)).toBe("8k");
  });

  it("renders exact millions without a trailing .0", () => {
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(2_000_000)).toBe("2M");
  });

  it("keeps one decimal for inexact millions", () => {
    expect(formatContextWindow(1_048_576)).toBe("1.0M");
    expect(formatContextWindow(1_500_000)).toBe("1.5M");
  });

  // Caps come straight from provider catalogs, which routinely omit the field —
  // returning null is what lets the caller skip rendering an empty chip.
  it("returns null for absent or nonsensical values", () => {
    for (const bad of [undefined, null, 0, -1, NaN, Infinity, "272000"]) {
      expect(formatContextWindow(bad)).toBeNull();
    }
  });
});
