import { afterEach, describe, expect, it, vi } from "vitest";

import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";

// Upstream silence (e.g. Claude thinking: only pings, which translation drops) must not
// leave the client byte-silent — proxies like Cloudflare cut such responses and the
// client then hangs forever.

function controllerStub() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => { connected = false; },
    handleError: () => { connected = false; },
    handleDisconnect: () => { connected = false; },
    abort: () => { connected = false; },
  };
}

function wrap(readable, keepaliveMs) {
  return createDisconnectAwareStream(
    { readable, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
    controllerStub(), null, keepaliveMs);
}

const dec = new TextDecoder();

afterEach(() => { vi.useRealTimers(); });

describe("SSE idle keepalive", () => {
  it("emits an SSE comment while upstream is silent", async () => {
    vi.useFakeTimers();
    const silent = new ReadableStream({ start() {} }); // never enqueues, never closes
    const reader = wrap(silent, 20000).getReader();
    const next = reader.read();
    await vi.advanceTimersByTimeAsync(21000);
    const { value } = await next;
    expect(dec.decode(value)).toBe(": keepalive\n\n");
    await reader.cancel();
  });

  it("stays quiet while real data keeps flowing", async () => {
    vi.useFakeTimers();
    let up;
    const upstream = new ReadableStream({ start(c) { up = c; } });
    const reader = wrap(upstream, 20000).getReader();
    const seen = [];
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(10000);
      up.enqueue(new TextEncoder().encode(`data: ${i}\n\n`));
      seen.push(dec.decode((await reader.read()).value));
    }
    expect(seen.join("")).not.toContain("keepalive");
    await reader.cancel();
  });

  it("disabled when keepaliveMs is 0", async () => {
    vi.useFakeTimers();
    let up;
    const upstream = new ReadableStream({ start(c) { up = c; } });
    const reader = wrap(upstream, 0).getReader();
    const next = reader.read();
    await vi.advanceTimersByTimeAsync(120000);
    up.enqueue(new TextEncoder().encode("data: x\n\n"));
    expect(dec.decode((await next).value)).toBe("data: x\n\n");
    await reader.cancel();
  });
});
