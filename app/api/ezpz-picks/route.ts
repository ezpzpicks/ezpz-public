import { NextRequest } from "next/server";
import { GET as getManualOfficialPicks } from "../official-picks/route";

// Backward-compatible public path. Since November 12, 2026 no signal/model
// candidate is an official EZPZ pick, and snapshot priming is forbidden here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (!url.searchParams.has("sport")) url.searchParams.set("sport", "MLB");
  url.searchParams.delete("prime");
  return getManualOfficialPicks(new NextRequest(url, { headers: request.headers }));
}
