"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "@/shared/components/Card";

const number = (value) => Number(value || 0).toLocaleString();
const when = (value) => value ? new Date(value).toLocaleString(undefined, { timeZone: "UTC" }) + " UTC" : "Not observed";
const inputClass = "min-h-11 rounded-lg border border-border bg-bg px-3 text-sm text-text-main focus-visible:outline-2 focus-visible:outline-primary";

function Ranking({ title, rows, sessions = false }) {
  return <Card title={title} subtitle="Top 100 by input + output tokens · scroll table for all columns" padding="sm" className="min-w-0">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm tabular-nums">
        <thead><tr className="border-b border-border text-text-muted">
          <th scope="col" className="p-2 text-left">{sessions ? "Session / owner" : "Owner (API key)"}</th>
          {["Requests", "Input", "Output", "Cached¹"].map((label) => <th key={label} scope="col" className="p-2 text-right">{label}</th>)}
        </tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-b border-border-subtle">
          <td className="p-2 max-w-64 break-words"><div className="font-medium">{sessions ? row.sessionId || "Unattributed" : row.ownerName}</div>
            {sessions && <div className="text-xs text-text-muted">{row.ownerName}</div>}
            {sessions && row.clientUser && <div className="text-xs text-text-muted">Client label (unverified): {row.clientUser}</div>}
          </td>
          {[row.requests, row.promptTokens, row.completionTokens, row.cachedTokens].map((value, i) => <td key={i} className="p-2 text-right whitespace-nowrap">{number(value)}</td>)}
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="py-8 text-center text-text-muted">No recorded requests in this range.</p>}
    </div>
  </Card>;
}

export default function UsageInsights() {
  const [start, setStart] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [connectionId, setConnectionId] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [windowName, setWindowName] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ start: `${start}T00:00:00.000Z`, end: `${end}T23:59:59.999Z` });
        if (connectionId) params.set("connectionId", connectionId);
        const response = await fetch(`/api/usage/insights?${params}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load insights");
        setData(result);
      } catch (failure) {
        if (failure.name !== "AbortError") { setError(failure.message); setData(null); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [start, end, connectionId, refresh]);

  const selected = data?.accounts.find((account) => account.connectionId === connectionId);
  const windows = [...new Set((data?.quotaHistory || []).flatMap((snapshot) => Object.keys(snapshot.quotas || {})))];
  const activeWindow = windows.includes(windowName) ? windowName : windows[0] || "";
  const points = (data?.quotaHistory || []).map((snapshot) => {
    const quota = snapshot.quotas[activeWindow];
    return { timestamp: Date.parse(snapshot.timestamp), usedPercent: quota?.unlimited ? null : typeof quota?.used === "number" && quota.total > 0 ? quota.used / quota.total * 100 : null,
      used: quota?.used, total: quota?.total, resetAt: quota?.resetAt };
  });
  const chartPoints = points.flatMap((point, index) => index > 0 && point.timestamp - points[index - 1].timestamp > 900000
    ? [{ timestamp: points[index - 1].timestamp + 1, usedPercent: null }, point] : [point]);

  return <div className="flex min-w-0 flex-col gap-4" aria-busy={loading}>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-text-muted">From (UTC)<input type="date" className={inputClass} value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">Through (UTC)<input type="date" className={inputClass} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-text-muted">Subscription<select className={inputClass} value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
        <option value="">All subscriptions</option>
        {(data?.accounts || []).map((account) => <option key={account.connectionId} value={account.connectionId}>{account.provider} · {account.accountName}</option>)}
      </select></label>
      <button className={`${inputClass} disabled:opacity-50`} onClick={() => setRefresh((value) => value + 1)} disabled={loading}>Refresh report</button>
    </div>
    {error && <p role="alert" className="text-error">{error}</p>}
    {loading && <p role="status" className="text-sm text-text-muted">Loading usage insights…</p>}
    {data && !loading && <>
      <div className="grid gap-3 sm:grid-cols-3">
        {[["Recorded requests", data.totals.requests], ["Input + output tokens", data.totals.promptTokens + data.totals.completionTokens], ["Without session ID", data.totals.unattributedRequests]].map(([label, value]) => <Card key={label} padding="sm"><p className="text-xs text-text-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{number(value)}</p></Card>)}
      </div>
      <p className="text-xs text-text-muted">Quota history is sampled every 5 minutes; gaps are unknown, not zero. Last attempt: {when(data.collector.lastPollAt)}. Collector last recorded since restart: {when(data.collector.lastSuccessAt)}. Historical session identity cannot be recovered when clients did not send it. People sharing an API key share an owner.</p>
      {data.collector.lastErrorAt && <p role="status" className="text-sm text-error">Collection degraded: an account probe or history write failed at {when(data.collector.lastErrorAt)}. Check observation timestamps.</p>}
      <Card title="Subscription limits" subtitle="Latest observed provider limits — not inferred token allowances" padding="sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm tabular-nums">
          <thead><tr className="border-b border-border text-text-muted">{["Subscription / window", "Used / provider limit", "Used %", "Resets", "Observed"].map((label) => <th key={label} scope="col" className="p-2 text-left">{label}</th>)}</tr></thead>
          <tbody>{data.accounts.filter((account) => !connectionId || account.connectionId === connectionId).flatMap((account) => Object.entries(account.quotas || { "No quota observation": {} }).map(([name, quota]) => {
            const percentage = typeof quota.used === "number" && quota.total > 0 ? quota.used / quota.total * 100 : null;
            const stale = Date.now() - Date.parse(account.timestamp) > 900000;
            return <tr key={`${account.connectionId}:${name}`} className="border-b border-border-subtle">
              <td className="p-2"><button className="min-h-11 text-left text-primary underline-offset-4 hover:underline focus-visible:outline-2" onClick={() => { setConnectionId(account.connectionId); setWindowName(name); }}>{account.accountName}</button><p className="text-xs text-text-muted">{account.provider} · {account.plan} · {name}</p></td>
              <td className="p-2 whitespace-nowrap">{quota.unlimited ? "Unlimited" : `${quota.used ?? "?"} / ${quota.total ?? "?"}`}</td>
              <td className={`p-2 ${percentage >= 90 ? "text-error" : "text-text-main"}`}>{percentage === null ? "Unknown" : `${percentage.toFixed(1)}%`}</td>
              <td className="p-2 whitespace-nowrap">{when(quota.resetAt)}</td><td className="p-2 whitespace-nowrap">{when(account.timestamp)}{stale && <span className="block text-error">Stale observation</span>}</td>
            </tr>;
          }))}</tbody>
        </table>{!data.accounts.length && <p className="py-8 text-center text-text-muted">No quota observations yet. Unsupported or unavailable providers do not have invented limits.</p>}</div>
      </Card>
      {connectionId && <Card title={`${selected?.accountName || "Subscription"} · limit history`} subtitle={`${data.quotaCount} observations · ${start} – ${end} UTC${data.quotaHistoryTruncated ? " · showing latest 2,000" : ""}`} padding="sm">
        <label className="flex flex-col gap-1 text-xs text-text-muted">Limit window<select className={`${inputClass} mb-4 w-full sm:w-72`} value={activeWindow} onChange={(event) => setWindowName(event.target.value)}>{windows.map((name) => <option key={name}>{name}</option>)}</select></label>
        {points.length ? <>
          <div className="h-56" role="img" aria-label={`${activeWindow} used percentage over time; exact observations in table below`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartPoints}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" /><XAxis type="number" scale="time" domain={["dataMin", "dataMax"]} dataKey="timestamp" tickFormatter={(value) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} minTickGap={60} /><YAxis unit="%" domain={[0, (maximum) => Math.max(100, Math.ceil(maximum / 10) * 10)]} />
            <Tooltip labelFormatter={when} formatter={(value) => [`${Number(value).toFixed(1)}%`, "Used"]} /><Line type="stepAfter" dataKey="usedPercent" stroke="var(--color-primary)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart></ResponsiveContainer></div>
          <details className="mt-3"><summary className="min-h-11 cursor-pointer text-sm text-primary">Exact observations (scroll for all rows)</summary><div className="max-h-72 overflow-auto"><table className="w-full min-w-[620px] text-sm whitespace-nowrap"><thead><tr>{["Observed", "Used / provider limit", "Used %", "Reset at"].map((label) => <th key={label} scope="col" className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{points.map((point, index) => <tr key={index} className="border-t border-border-subtle"><td className="p-2">{when(point.timestamp)}</td><td className="p-2">{point.used ?? "?"} / {point.total ?? "?"}</td><td className="p-2">{point.usedPercent === null ? "Unknown" : `${point.usedPercent.toFixed(1)}%`}</td><td className="p-2">{when(point.resetAt)}</td></tr>)}</tbody></table></div></details>
        </> : <p className="py-8 text-center text-text-muted">No quota history in this range. Collection starts with this version.</p>}
      </Card>}
      <div className="grid min-w-0 gap-4 xl:grid-cols-2"><Ranking title="Who uses the most" rows={data.owners} /><Ranking title="Which sessions use the most" rows={data.sessions} sessions /></div>
      <p className="text-xs text-text-muted">¹ Cached tokens are included in input tokens, not added on top. Rankings cover the selected subscription and dates; token volume is not the provider’s subscription billing formula. Client labels are self-reported, API-key ownership is authoritative.</p>
    </>}
  </div>;
}
