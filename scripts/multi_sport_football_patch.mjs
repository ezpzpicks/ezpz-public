import fs from "node:fs";

function replaceOnce(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one old block, found ${count}`);
  return text.replace(oldText, newText);
}

function patchRoute() {
  const path = "app/api/public-data/route.ts";
  let text = fs.readFileSync(path, "utf8");
  text = replaceOnce(
    text,
    'import { readWorksheet as readWorksheetUncached } from "../../../lib/googleSheets";\n',
    'import { readWorksheet as readWorksheetUncached } from "../../../lib/googleSheets";\nimport { buildFootballPublicData } from "../../../lib/footballPublicData";\n',
    "football route import",
  );
  text = replaceOnce(
    text,
    `export async function GET(request: NextRequest) {\n  // Background/scheduled requests must run the snapshot workflow immediately.`,
    `export async function GET(request: NextRequest) {\n  const requestedSport = String(request.nextUrl.searchParams.get("sport") || "MLB").trim().toUpperCase();\n  if (requestedSport === "NFL" || requestedSport === "NCAAF") {\n    try {\n      return NextResponse.json(await buildFootballPublicData(requestedSport));\n    } catch (error) {\n      console.error(\`\${requestedSport} public data failed\`, error);\n      return NextResponse.json(\n        { ok: false, sport: requestedSport, error: error instanceof Error ? error.message : String(error) },\n        { status: 500 },\n      );\n    }\n  }\n\n  // Background/scheduled requests must run the snapshot workflow immediately.`,
    "football route delegation",
  );
  fs.writeFileSync(path, text);
}

function patchPage() {
  const path = "app/page.tsx";
  let text = fs.readFileSync(path, "utf8");
  text = replaceOnce(
    text,
    `"use client";\n\n`,
    `"use client";\n\nimport FootballBoard from "./FootballBoard";\n\n`,
    "football board import",
  );
  text = text.replaceAll('market: "Moneyline" | "Total";', 'market: "Moneyline" | "Spread" | "Total";');
  text = text.replaceAll('market: "Moneyline" | "Total",', 'market: "Moneyline" | "Spread" | "Total",');
  text = text.replaceAll('market: "Moneyline" | "Run Line" | "Total";', 'market: "Moneyline" | "Run Line" | "Spread" | "Total";');

  const simpleFetch = `        const response = await fetch("/api/public-data", {\n          cache: "no-store",`;
  const optimizedFetch = `        const response = await fetch(forceFresh ? "/api/public-data?refresh=1" : "/api/public-data", {\n          cache: "no-store",`;
  const simpleSportFetch = `        const endpoint =\n          activeSport === "NFL" || activeSport === "NCAAF"\n            ? \`/api/public-data?sport=\${activeSport}\`\n            : "/api/public-data";\n        const response = await fetch(endpoint, {\n          cache: "no-store",`;
  const optimizedSportFetch = `        const endpoint =\n          activeSport === "NFL" || activeSport === "NCAAF"\n            ? \`/api/public-data?sport=\${activeSport}\${forceFresh ? "&refresh=1" : ""}\`\n            : forceFresh\n              ? "/api/public-data?refresh=1"\n              : "/api/public-data";\n        const response = await fetch(endpoint, {\n          cache: "no-store",`;

  if (text.includes(optimizedSportFetch) || text.includes(simpleSportFetch)) {
    // Already sport-aware.
  } else if (text.includes(optimizedFetch)) {
    text = text.replace(optimizedFetch, optimizedSportFetch);
  } else if (text.includes(simpleFetch)) {
    text = text.replace(simpleFetch, simpleSportFetch);
  } else {
    throw new Error("sport-aware public fetch: supported public-data fetch target not found");
  }

  text = replaceOnce(
    text,
    `  }, []);\n\n  useEffect(() => {\n    void loadData();`,
    `  }, [activeSport]);\n\n  useEffect(() => {\n    void loadData();`,
    "reload data when sport changes",
  );
  text = replaceOnce(
    text,
    `    if (activeSport !== "MLB") {\n      return (\n        <SportDevelopmentContent\n          sport={activeSport}\n          tab={active}\n          today={data.today}\n        />\n      );\n    }`,
    `    if (activeSport === "NFL" || activeSport === "NCAAF") {\n      return (\n        <FootballBoard\n          sport={activeSport}\n          tab={active}\n          data={data as any}\n        />\n      );\n    }\n\n    if (activeSport !== "MLB") {\n      return (\n        <SportDevelopmentContent\n          sport={activeSport}\n          tab={active}\n          today={data.today}\n        />\n      );\n    }`,
    "live football content",
  );

  const oldTiles = `          ) : (\n            <>\n              <Tile\n                label="Best Plays - Last 7 Days"\n                value="0-0-0"\n                meta="0.0% • 0.00u • ROI 0.0%"\n              />\n              <Tile\n                label="Best Plays - Running Total"\n                value="0-0-0"\n                meta="Tracking begins with official plays"\n              />\n              <Tile\n                label="Today’s Handpicked"\n                value="0"\n                meta="No selections posted"\n              />\n              <Tile\n                label="Model Stage"\n                value="PRESEASON"\n                meta={activeSportMeta.status}\n              />\n              <Tile\n                label="Today’s Best Plays"\n                value="0"\n                meta="Public format is ready"\n              />\n              <Tile\n                label="Published Matchups"\n                value="0"\n                meta="Slate connection pending"\n              />\n            </>\n          )}`;
  const newTiles = `          ) : activeSport === "NFL" || activeSport === "NCAAF" ? (\n            <>\n              <Tile\n                label="Best Plays - Last 7 Days"\n                value={data.tiles.last7Days.record}\n                meta={\`\${data.tiles.last7Days.winPct}% • \${data.tiles.last7Days.unitsWon}u • ROI \${data.tiles.last7Days.roiPct}%\`}\n                green={data.tiles.last7Days.totalBets > 0}\n              />\n              <Tile\n                label="Best Plays - Running Total"\n                value={data.tiles.overallGreen.record}\n                meta={\`\${data.tiles.overallGreen.winPct}% • \${data.tiles.overallGreen.unitsWon}u • ROI \${data.tiles.overallGreen.roiPct}%\`}\n                green={data.tiles.overallGreen.totalBets > 0}\n              />\n              <Tile label="Today’s Best Plays" value={String(data.bestPlays.length)} meta="Spread + Total" green={data.bestPlays.length > 0} />\n              <Tile label="Today’s Trend Plays" value={String((data.trendPlays || []).filter((play) => play.tier !== "Pass").length)} meta="Sport-specific DraftKings records" />\n              <Tile label="Model Stage" value="LIVE" meta={activeSportMeta.status} green />\n              <Tile label="Published Matchups" value={String(data.slateToday.length)} meta="Separate sport database" green={data.slateToday.length > 0} />\n            </>\n          ) : (\n            <>\n              <Tile label="Best Plays - Last 7 Days" value="0-0-0" meta="0.0% • 0.00u • ROI 0.0%" />\n              <Tile label="Best Plays - Running Total" value="0-0-0" meta="Tracking begins with official plays" />\n              <Tile label="Today’s Handpicked" value="0" meta="No selections posted" />\n              <Tile label="Model Stage" value="PRESEASON" meta={activeSportMeta.status} />\n              <Tile label="Today’s Best Plays" value="0" meta="Public format is ready" />\n              <Tile label="Published Matchups" value="0" meta="Slate connection pending" />\n            </>\n          )}`;
  text = replaceOnce(text, oldTiles, newTiles, "football live summary tiles");

  text = text.replace(
    `    status: "Preseason development",\n    description:\n      "Matchup-adjusted spreads, moneylines, totals, projected scores, and personnel reliability.",`,
    `    status: "Live model",\n    description:\n      "Regression spreads and totals, price-aware markets, projected scores, personnel reliability, and sport-specific trend records.",`,
  );
  text = text.replace(
    `    status: "Preseason development",\n    description:\n      "Opponent-adjusted team strength, projected possessions, availability, and game-environment modeling.",`,
    `    status: "Live model",\n    description:\n      "Regression-based margins, calibrated spread uncertainty, totals, availability, and sport-specific trend records.",`,
  );
  fs.writeFileSync(path, text);
}

patchRoute();
patchPage();
