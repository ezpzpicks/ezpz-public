import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname !== "/api/public-data") return NextResponse.next();
  const sport = String(request.nextUrl.searchParams.get("sport") || "MLB").trim().toUpperCase();
  if (sport === "NFL" || sport === "NCAAF") return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/api/public-data-v2";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/api/public-data"],
};
