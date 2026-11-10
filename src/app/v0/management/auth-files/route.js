import { hasUsageHubAccess, listUsageHubAccounts } from "@/lib/usageHub.js";

export const dynamic = "force-dynamic";
export async function GET(request) {
  if (!hasUsageHubAccess(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ files: await listUsageHubAccounts() }, { headers: { "Cache-Control": "no-store" } });
}
