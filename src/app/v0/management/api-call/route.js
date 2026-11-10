import { hasUsageHubAccess, readUsageHubCall } from "@/lib/usageHub.js";

export const dynamic = "force-dynamic";
export async function POST(request) {
  if (!hasUsageHubAccess(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body;
  try {
    const text = await request.text();
    if (text.length > 8192) return Response.json({ error: "Request too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  return Response.json(await readUsageHubCall(body), { headers: { "Cache-Control": "no-store" } });
}
