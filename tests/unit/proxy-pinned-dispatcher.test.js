import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("caller-pinned fetch transport", () => {
  const savedEnv = { ...process.env };
  const savedFetch = globalThis.fetch;
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    process.env = { ...savedEnv };
    globalThis.fetch = savedFetch;
    vi.doUnmock("undici");
  });

  it("retains a pinned dispatcher despite environment proxy, MITM bypass and fresh retry options", async () => {
    process.env.HTTPS_PROXY = "http://proxy.invalid:8080";
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.doMock("undici", () => ({ fetch }));
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const dispatcher = { dispatch: vi.fn() };
    const options = { dispatcher, redirect: "manual", forceFreshSocket: true };
    await proxyAwareFetch("https://api.github.com/image.png", options);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://api.github.com/image.png", options);
  });

  it.each(["UND_ERR_SOCKET", "SELF_SIGNED_CERT_IN_CHAIN"])("never replaces pinned transport after %s", async (code) => {
    const error = Object.assign(new Error("transport rejected"), { cause: { code } });
    const fetch = vi.fn().mockRejectedValue(error);
    vi.doMock("undici", () => ({ fetch }));
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const dispatcher = { dispatch: vi.fn() };
    await expect(proxyAwareFetch("https://public.invalid/image", { dispatcher })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].dispatcher).toBe(dispatcher);
  });

  it("fails closed when a pinned caller also requires a proxy", async () => {
    const fetch = vi.fn();
    vi.doMock("undici", () => ({ fetch }));
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await expect(proxyAwareFetch("https://public.invalid/image", { dispatcher: {} }, { strictProxy: true })).rejects.toThrow(/pinned transport/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
