import { describe, it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ token: vi.fn(), exchange: vi.fn(), verify: vi.fn(), cookies: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { redirect: url => ({ status: 307, location: String(url) }) } }));
vi.mock("next/headers", () => ({ cookies: m.cookies }));
vi.mock("@/lib/auth/dashboardSession", () => ({ setDashboardAuthCookie: m.token }));
vi.mock("@/lib/auth/oidc", async importOriginal => ({
  ...await importOriginal(), getPublicOrigin: () => "https://aiproxy.entelechia.cloud",
  getOidcRuntimeConfig: async () => ({ issuerUrl: "https://auth.entelechia.cloud", clientId: "test", clientSecret: "test" }),
  fetchOidcDiscovery: async () => ({ issuer: "https://auth.entelechia.cloud", token_endpoint: "https://auth.entelechia.cloud/token", jwks_uri: "https://auth.entelechia.cloud/keys" }),
  exchangeOidcCode: m.exchange, verifyOidcIdToken: m.verify,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn() }));
const { GET } = await import("../../src/app/api/auth/oidc/callback/route.js");
beforeEach(() => {
  vi.clearAllMocks();
  process.env.OIDC_ALLOWED_SUBJECTS = "383437416599388195";
  m.cookies.mockResolvedValue({ get: name => ({ value: { oidc_state: "state", oidc_nonce: "nonce", oidc_code_verifier: "verifier" }[name] }), delete: vi.fn() });
  m.exchange.mockResolvedValue({ id_token: "signed-token" });
});
describe("OIDC callback authorization", () => {
  it("rejects an invalid-state callback before token exchange", async () => {
    const r = await GET({ url: "https://aiproxy.entelechia.cloud/api/auth/oidc/callback?code=x&state=wrong" });
    expect(r.location).toContain("oidc_invalid_state");
    expect(m.exchange).not.toHaveBeenCalled();
    expect(m.token).not.toHaveBeenCalled();
  });
  it("does not mint a session for an arbitrary valid Zitadel user", async () => {
    m.verify.mockResolvedValue({ sub: "other-valid-zitadel-user", email: "raisalpwardana@gmail.com" });
    const r = await GET({ url: "https://aiproxy.entelechia.cloud/api/auth/oidc/callback?code=x&state=state" });
    expect(r.location).toContain("oidc_access_denied");
    expect(m.token).not.toHaveBeenCalled();
  });
  it("mints the existing dashboard session only for the explicitly approved subject", async () => {
    m.verify.mockResolvedValue({ sub: "383437416599388195", email: "raisalpwardana@gmail.com" });
    const r = await GET({ url: "https://aiproxy.entelechia.cloud/api/auth/oidc/callback?code=x&state=state" });
    expect(r.location).toBe("https://aiproxy.entelechia.cloud/dashboard");
    expect(m.token).toHaveBeenCalledOnce();
  });
});
