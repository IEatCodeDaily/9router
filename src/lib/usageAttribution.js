import { extractClientSessionId } from "open-sse/utils/sessionManager.js";

// Client labels aid diagnostics; only the authenticated API key identifies an owner.
export function getUsageAttribution(request) {
  const { headers, body } = request || {};
  const raw = headers?.entries ? Object.fromEntries(headers.entries()) : headers || {};
  const normalized = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.toLowerCase(), value]));
  const label = (value) => typeof value === "string" && value.trim().length <= 256
    ? value.trim().replace(/[\x00-\x1f\x7f]/g, "") || null : null;
  return {
    sessionId: label(extractClientSessionId(normalized, body, "kiro")),
    clientUser: label(normalized["x-9router-user"] || body?.user),
    client: label(normalized["x-9router-client"] || normalized["user-agent"]),
  };
}
