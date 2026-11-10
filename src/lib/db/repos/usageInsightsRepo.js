import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export async function saveQuotaSnapshot(connection, usage, timestamp = new Date().toISOString()) {
  if (!connection?.id || !usage?.quotas || usage.message || usage.error) return;
  // Persist only quota fields, never provider credentials or raw API payloads.
  const quotas = {};
  for (const [name, quota] of Object.entries(usage.quotas)) {
    if (!quota || typeof quota !== "object") continue;
    const clean = {};
    for (const key of ["used", "total", "remaining", "remainingPercentage", "windowSeconds"]) {
      if (typeof quota[key] === "number" && Number.isFinite(quota[key])) clean[key] = quota[key];
    }
    clean.resetAt = quota.resetAt && Number.isFinite(Date.parse(quota.resetAt)) ? new Date(quota.resetAt).toISOString() : null;
    clean.unlimited = quota.unlimited === true;
    quotas[name] = clean;
  }
  if (!Object.keys(quotas).length) return;
  if (usage.observedAt && Number.isFinite(Date.parse(usage.observedAt))) timestamp = new Date(usage.observedAt).toISOString();
  const db = await getAdapter();
  const data = stringifyJson({ plan: typeof usage.plan === "string" ? usage.plan : null, quotas });
  // A dashboard refresh must not multiply identical observations within a minute.
  const previous = db.get("SELECT timestamp, data FROM quotaHistory WHERE connectionId = ? ORDER BY id DESC LIMIT 1", [connection.id]);
  if (previous?.data === data && Date.parse(timestamp) - Date.parse(previous.timestamp) < 60000) return previous.timestamp;
  db.run("INSERT INTO quotaHistory(timestamp, connectionId, provider, accountName, data) VALUES(?, ?, ?, ?, ?)",
    [timestamp, connection.id, connection.provider, connection.name || connection.email || connection.id, data]);
  return timestamp;
}

export function parseInsightsRange(searchParams, now = Date.now()) {
  const start = searchParams.get("start") || new Date(now - 7 * 86400000).toISOString();
  const end = searchParams.get("end") || new Date(now).toISOString();
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) > Date.parse(end)) {
    throw new Error("Invalid date range");
  }
  if (Date.parse(end) - Date.parse(start) > 93 * 86400000) throw new Error("Select a date range of 93 days or less");
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

export async function getUsageInsights({ start, end, connectionId = null }) {
  const db = await getAdapter();
  const where = "u.timestamp >= ? AND u.timestamp <= ?" + (connectionId ? " AND u.connectionId = ?" : "");
  const params = [start, end, ...(connectionId ? [connectionId] : [])];
  const metrics = `COUNT(*) AS requests, COALESCE(SUM(u.promptTokens), 0) AS promptTokens,
    COALESCE(SUM(u.completionTokens), 0) AS completionTokens,
    COALESCE(SUM(json_extract(u.tokens, '$.cached_tokens')), 0) AS cachedTokens,
    COALESCE(SUM(u.cost), 0) AS cost`;
  const owner = "COALESCE(json_extract(u.meta, '$.ownerId'), k.id, CASE WHEN u.apiKey IS NULL THEN 'local' ELSE 'deleted-key:' || u.apiKey END)";
  // A stable digest identifies deleted keys without returning their secret in the report.
  const { createHash } = await import("node:crypto");
  const publicOwner = (row) => {
    if (!row.ownerId?.startsWith("deleted-key:")) return row;
    const digest = createHash("sha256").update(row.ownerId).digest("hex").slice(0, 16);
    return { ...row, ownerId: `deleted-key:${digest}`, ownerName: `Unresolved historical key · ${digest.slice(0, 8)}` };
  };
  const join = "FROM usageHistory u LEFT JOIN apiKeys k ON k.key = u.apiKey";
  const sessions = db.all(`SELECT json_extract(u.meta, '$.sessionId') AS sessionId,
    ${owner} AS ownerId, COALESCE(json_extract(u.meta, '$.ownerName'), k.name, CASE WHEN u.apiKey IS NULL THEN 'Local (no key)' ELSE 'Deleted API key' END) AS ownerName,
    MAX(json_extract(u.meta, '$.clientUser')) AS clientUser, MAX(json_extract(u.meta, '$.client')) AS client,
    MIN(u.timestamp) AS firstSeen, MAX(u.timestamp) AS lastSeen, ${metrics}
    ${join} WHERE ${where} GROUP BY ownerId, sessionId ORDER BY SUM(u.promptTokens + u.completionTokens) DESC LIMIT 100`, params).map(publicOwner);
  const owners = db.all(`SELECT ${owner} AS ownerId,
    COALESCE(json_extract(u.meta, '$.ownerName'), k.name, CASE WHEN u.apiKey IS NULL THEN 'Local (no key)' ELSE 'Deleted API key' END) AS ownerName, ${metrics}
    ${join} WHERE ${where} GROUP BY ownerId ORDER BY SUM(u.promptTokens + u.completionTokens) DESC LIMIT 100`, params).map(publicOwner);
  const totals = db.get(`SELECT ${metrics},
    SUM(CASE WHEN json_extract(u.meta, '$.sessionId') IS NULL THEN 1 ELSE 0 END) AS unattributedRequests,
    MIN(u.timestamp) AS firstSeen FROM usageHistory u WHERE ${where}`, params);
  const accounts = db.all(`WITH ids AS (
      SELECT id AS connectionId FROM providerConnections UNION SELECT connectionId FROM usageHistory WHERE connectionId IS NOT NULL
      UNION SELECT connectionId FROM quotaHistory
    ), latest AS (SELECT connectionId, MAX(id) AS id FROM quotaHistory GROUP BY connectionId)
    SELECT ids.connectionId, COALESCE(c.provider, q.provider, (SELECT provider FROM usageHistory WHERE connectionId = ids.connectionId LIMIT 1)) AS provider,
      COALESCE(c.name, c.email, q.accountName, ids.connectionId) AS accountName, q.timestamp, q.data
    FROM ids LEFT JOIN providerConnections c ON c.id = ids.connectionId
    LEFT JOIN latest ON latest.connectionId = ids.connectionId LEFT JOIN quotaHistory q ON q.id = latest.id
    ORDER BY provider, accountName`).map(({ data, ...row }) => ({ ...row, ...parseJson(data, {}) }));
  let quotaHistory = [];
  let quotaCount = 0;
  if (connectionId) {
    quotaCount = db.get("SELECT COUNT(*) AS count FROM quotaHistory WHERE connectionId = ? AND timestamp >= ? AND timestamp <= ?", [connectionId, start, end]).count;
    quotaHistory = db.all("SELECT id, timestamp, data FROM quotaHistory WHERE connectionId = ? AND timestamp >= ? AND timestamp <= ? ORDER BY id DESC LIMIT 2000", [connectionId, start, end])
      .reverse().map(({ data, ...row }) => ({ ...row, ...parseJson(data, {}) }));
  }
  return { start, end, totals, sessions, owners, accounts, quotaHistory, quotaCount, quotaHistoryTruncated: quotaCount > quotaHistory.length, rankingLimit: 100 };
}
