import { getUsageInsights, parseInsightsRange } from "@/lib/db/repos/usageInsightsRepo.js";
import { getQuotaCollectorStatus } from "@/shared/services/quotaHistory.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  let range;
  try { range = parseInsightsRange(params); }
  catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
  try {
    const insights = await getUsageInsights({ ...range, connectionId: params.get("connectionId") || null });
    return Response.json({ ...insights, collector: getQuotaCollectorStatus() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Usage insights]", error.message);
    return Response.json({ error: "Unable to load usage insights" }, { status: 500 });
  }
}
