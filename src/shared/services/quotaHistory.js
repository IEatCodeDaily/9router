import { getProviderConnections } from "@/lib/localDb";
import { GET as fetchConnectionUsage } from "@/app/api/usage/[connectionId]/route.js";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";
import { withFetchSignal } from "open-sse/utils/proxyFetch.js";

const state = global.__quotaHistory ??= { timer: null, running: false, lastPollAt: null, lastErrorAt: null };

export async function collectQuotaHistory() {
  if (state.running) return;
  state.running = true;
  try {
    const connections = await getProviderConnections();
    // Sequential polling keeps quota APIs (especially Claude) below their rate limit.
    for (const connection of connections) {
      if (connection.isActive === false || !(connection.authType === "oauth" ||
          (["apikey", "api_key"].includes(connection.authType) && USAGE_APIKEY_PROVIDERS.includes(connection.provider)))) continue;
      const signal = AbortSignal.timeout(12000);
      try {
        // An existing provider promise may belong to another caller without our signal.
        // Bound the entire await, not just fetches this poll starts.
        await Promise.race([
          withFetchSignal(signal, async () => {
            const response = await fetchConnectionUsage(new Request("http://localhost/api/usage/history-poll"), {
              params: Promise.resolve({ connectionId: connection.id }),
            });
            const result = await response.json();
            signal.throwIfAborted();
            if (!response.ok || result.error || result.message || result.historyError || !result.recordedAt) throw new Error("Quota observation unavailable");
            state.lastSuccessAt = result.recordedAt;
          }),
          new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
        ]);
      } catch { state.lastErrorAt = new Date().toISOString(); }
    }
    state.lastPollAt = new Date().toISOString();
  } catch (error) {
    state.lastErrorAt = new Date().toISOString();
    console.error("[Quota history] Poll failed:", error.message);
  } finally {
    state.running = false;
  }
}

export function getQuotaCollectorStatus() {
  return { running: state.running, lastPollAt: state.lastPollAt, lastSuccessAt: state.lastSuccessAt || null, lastErrorAt: state.lastErrorAt, intervalSeconds: 300 };
}

export function startQuotaHistory() {
  if (state.timer) return;
  state.timer = setInterval(collectQuotaHistory, 300000);
  state.timer.unref?.();
  void collectQuotaHistory();
}
