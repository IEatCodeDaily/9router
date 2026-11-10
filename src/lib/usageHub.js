import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { getAdapter } from "./db/driver.js";
import { parseJson } from "./db/helpers/jsonCol.js";

export function hasUsageHubAccess(request) {
  // Dedicated read-only credential; inference keys must not expose every account.
  let expected = process.env.NINEROUTER_USAGE_MANAGEMENT_KEY || "";
  if (process.env.NINEROUTER_USAGE_MANAGEMENT_KEY_FILE) {
    try { expected = readFileSync(process.env.NINEROUTER_USAGE_MANAGEMENT_KEY_FILE, "utf8").trim(); }
    catch { return false; }
  }
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function listUsageHubAccounts() {
  const db = await getAdapter();
  // Never select the credential JSON. Only actual enabled subscription accounts.
  return db.all("SELECT id, provider, email, isActive FROM providerConnections WHERE provider IN ('codex', 'claude') AND authType = 'oauth'")
    .map((row) => ({ id: row.id, auth_index: row.id, provider: row.provider, ...(row.email ? { email: row.email } : {}), disabled: row.isActive === 0 }));
}

function percentWindow(quota, codex = false, fallbackSeconds) {
  if (!quota || quota.unlimited || typeof quota.used !== "number" || !(quota.total > 0)) return null;
  if (quota.resetAt && Date.parse(quota.resetAt) <= Date.now()) return null;
  const percent = Math.max(0, Math.min(100, quota.used / quota.total * 100));
  // Upstream window length decides session vs weekly in T3; the position-based default is only a fallback.
  return codex
    ? { used_percent: percent, reset_at: quota.resetAt ? Math.floor(Date.parse(quota.resetAt) / 1000) : null, limit_window_seconds: quota.windowSeconds ?? fallbackSeconds }
    : { utilization: percent, resets_at: quota.resetAt || null };
}

export function toUsageHubPayload(provider, usage) {
  const quotas = usage.quotas || {};
  if (provider === "codex") {
    const primary = percentWindow(quotas.session, true, 18000);
    const secondary = percentWindow(quotas.weekly, true, 604800);
    if (!primary && !secondary) return null;
    return { plan_type: usage.plan || "unknown", rate_limit: {
      ...(primary ? { primary_window: primary } : {}),
      ...(secondary ? { secondary_window: secondary } : {}),
    } };
  }
  const fiveHour = percentWindow(quotas["session (5h)"]);
  const sevenDay = percentWindow(quotas["weekly (7d)"]);
  const limits = Object.entries(quotas).flatMap(([name, quota]) => {
    const model = name.match(/^weekly (.+) \(7d\)$/)?.[1];
    const window = percentWindow(quota);
    return model && window ? [{ kind: "weekly_scoped", percent: window.utilization, resets_at: window.resets_at, scope: { model: { display_name: model } } }] : [];
  });
  if (!fiveHour && !sevenDay && !limits.length) return null;
  return { five_hour: fiveHour, seven_day: sevenDay, limits };
}

export async function readUsageHubCall(body) {
  if (body?.method !== "GET" || typeof body.auth_index !== "string") return { status_code: 400, body: JSON.stringify({ error: "Only read-only quota probes are supported" }) };
  const db = await getAdapter();
  const connection = db.get("SELECT id, provider FROM providerConnections WHERE id = ? AND isActive = 1 AND authType = 'oauth' AND provider IN ('codex', 'claude')", [body.auth_index]);
  if (!connection) return { status_code: 404, body: JSON.stringify({ error: "Unknown active subscription" }) };
  const urls = { codex: "https://chatgpt.com/backend-api/wham/usage", claude: "https://api.anthropic.com/api/oauth/usage" };
  // This is a compatibility facade, NOT an HTTP forwarder. Ignore caller headers.
  if (body.url !== urls[connection.provider]) return { status_code: 403, body: JSON.stringify({ error: "Unsupported quota operation" }) };
  const snapshot = db.get("SELECT timestamp, data FROM quotaHistory WHERE connectionId = ? ORDER BY id DESC LIMIT 1", [connection.id]);
  if (!snapshot || Date.now() - Date.parse(snapshot.timestamp) > 900000) {
    return { status_code: 503, body: JSON.stringify({ error: "No fresh quota observation" }) };
  }
  const payload = toUsageHubPayload(connection.provider, parseJson(snapshot.data, {}));
  return payload ? { status_code: 200, body: JSON.stringify(payload) }
    : { status_code: 503, body: JSON.stringify({ error: "Quota windows unavailable" }) };
}
