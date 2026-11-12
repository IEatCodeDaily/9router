// Combo all-failed error must carry the SOONEST member reset, not the last member's.
// Incident 2026-11-11: cc (short 429) + ag (4h58m quota) → clients saw ~5h for an alias usable in minutes.
import { describe, expect, it } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, debug() {}, error() {} };
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const fail = (message, retryAfter) =>
  new Response(JSON.stringify({ error: { message: retryAfter ? `${message} (reset after x)` : message }, ...(retryAfter && { retryAfter }) }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });

async function run(results) {
  const res = await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models: Object.keys(results),
    handleSingleModel: async (_b, m) => results[m](),
    log,
    comboName: `soonest-${Math.random()}`,
    comboStrategy: "fallback",
  });
  return { res, body: await res.json() };
}

describe("combo all-failed reset", () => {
  it("reports the soonest declared reset, not the last member's", async () => {
    const { res, body } = await run({
      "cc/opus": () => fail("cc rate limited", iso(267_000)),
      "ag/opus": () => fail("ag quota reached", iso(5 * 3600_000)),
    });
    const sec = Number(res.headers.get("retry-after"));
    expect(sec).toBeGreaterThan(200);
    expect(sec).toBeLessThanOrEqual(268);
    expect(body.error.message).toMatch(/^cc rate limited \(reset after 4m/);
    expect(res.status).toBe(429);
    expect(body.error).toMatchObject({ code: "quota_exhausted", scope: "combo" });
    expect(Math.abs(Date.parse(body.error.reset_at) - Date.now() - 267_000)).toBeLessThan(5_000);
  });

  it("emits no long reset when a member declared none", async () => {
    const { res, body } = await run({
      "cc/opus": () => fail("cc try again later"),
      "ag/opus": () => fail("ag quota reached", iso(5 * 3600_000)),
    });
    expect(res.headers.get("retry-after")).toBeNull();
    expect(body.error.message).toBe("cc try again later");
  });

  it("honours a Retry-After header in seconds", async () => {
    const { res } = await run({
      "cc/opus": () => new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429, headers: { "retry-after": "30" } }),
      "ag/opus": () => fail("ag quota reached", iso(5 * 3600_000)),
    });
    expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(30);
  });
});
