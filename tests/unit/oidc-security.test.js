import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn() }));
const oidc = await import("../../src/lib/auth/oidc.js");
let server, jwksUri, privateKey;
const issuer = "https://auth.entelechia.cloud";
const audience = "9router-test";
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [{ ...jwk, kid: "test", alg: "RS256" }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  jwksUri = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
async function token(claims = {}) {
  return new SignJWT({ nonce: "expected-nonce", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("approved-user").setIssuer(issuer).setAudience(audience)
    .setIssuedAt().setExpirationTime("5m").sign(privateKey);
}
const verify = async (claims, options = {}) => oidc.verifyOidcIdToken({
  idToken: await token(claims), issuer, audience, jwksUri, nonce: "expected-nonce", ...options,
});
describe("OIDC dashboard trust boundary", () => {
  it("accepts the matching nonce", async () => {
    expect((await verify({})).sub).toBe("approved-user");
  });
  it("rejects a signed token with a different nonce", async () => {
    await expect(verify({ nonce: "attacker-nonce" })).rejects.toThrow();
  });
  it("rejects a signed token missing nonce", async () => {
    await expect(verify({ nonce: undefined })).rejects.toThrow();
  });
  it("rejects missing expected nonce", async () => {
    await expect(verify({}, { nonce: undefined })).rejects.toThrow();
  });
  it("retains issuer and audience validation", async () => {
    await expect(verify({}, { issuer: "https://evil.invalid" })).rejects.toThrow();
    await expect(verify({}, { audience: "another-app" })).rejects.toThrow();
  });
  it("denies all identities without an explicit subject allowlist", () => {
    delete process.env.OIDC_ALLOWED_SUBJECTS;
    expect(() => oidc.assertOidcDashboardAccess({ sub: "approved-user" })).toThrow();
  });
  it("allows only exact approved subjects, never email or role lookalikes", () => {
    process.env.OIDC_ALLOWED_SUBJECTS = "approved-user,second-user";
    expect(() => oidc.assertOidcDashboardAccess({ sub: "approved-user" })).not.toThrow();
    for (const payload of [{}, { sub: "approved-user-suffix" }, { sub: "stranger", email: "approved-user", roles: ["admin"] }]) {
      expect(() => oidc.assertOidcDashboardAccess(payload)).toThrow();
    }
    delete process.env.OIDC_ALLOWED_SUBJECTS;
  });
  it("rejects a discovery document with a different issuer", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ issuer: "https://evil.invalid" }) }));
    try { await expect(oidc.fetchOidcDiscovery(issuer)).rejects.toThrow(); }
    finally { globalThis.fetch = original; }
  });
  it("rejects non-HTTPS discovery endpoints", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ issuer, authorization_endpoint: "http://evil.invalid", token_endpoint: issuer + "/token", jwks_uri: issuer + "/keys" }) }));
    try { await expect(oidc.fetchOidcDiscovery(issuer)).rejects.toThrow(); }
    finally { globalThis.fetch = original; }
  });
});
