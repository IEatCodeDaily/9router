// Oversized embedding input must not lock the connection. Payloads pinned to the
// live llama.cpp backend behind selfhosted-embedding (gc-01 journal 2026-11-26):
//   [500]: input (3223 tokens) is too large to process. increase the physical batch size
// That 500 used to take the 30s transient lock, so every later embeddings call on
// the single connection failed with "all 1 accounts locked".
import { describe, it, expect } from "vitest";
import { checkFallbackError } from "open-sse/services/accountFallback.js";

const CASES = [
  [500, "input (3223 tokens) is too large to process. increase the physical batch size (current batch size: 2048)"],
  [400, JSON.stringify({ error: { code: 400, type: "exceed_context_size_error", message: "request (9000 tokens) exceeds the available context size (8192 tokens)" } })],
  [500, "input is larger than the max context size. skipping"],
];

describe("oversized embedding input is request-scoped", () => {
  it.each(CASES)("status %i does not lock the account", (status, text) => {
    expect(checkFallbackError(status, text, 0, "selfhosted-embedding")).toEqual({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
  });

  it("a plain 500 still takes the transient lock", () => {
    expect(checkFallbackError(500, "internal error", 0).shouldFallback).toBe(true);
  });
});
