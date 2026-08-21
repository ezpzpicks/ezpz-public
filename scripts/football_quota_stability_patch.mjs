import fs from "node:fs";

function replaceOnce(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  const count = text.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one target, found ${count}`);
  }
  return text.replace(oldText, newText);
}

function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label}: end marker not found`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function insertBeforeFunctionEnd(text, functionMarker, nextMarker, line, label) {
  const start = text.indexOf(functionMarker);
  if (start < 0) throw new Error(`${label}: function marker not found`);
  const end = text.indexOf(nextMarker, start);
  if (end < 0) throw new Error(`${label}: next marker not found`);
  const block = text.slice(start, end);
  if (block.includes(line.trim())) return text;
  const close = block.lastIndexOf("\n}");
  if (close < 0) throw new Error(`${label}: function close not found`);
  const patched = block.slice(0, close) + `\n${line}` + block.slice(close);
  return text.slice(0, start) + patched + text.slice(end);
}

function patchSportSheets() {
  const path = "lib/sportSheets.ts";
  let text = fs.readFileSync(path, "utf8");

  if (!text.includes("SPORT_WORKSHEET_READ_CACHE_TTL_MS")) {
    const anchor = "const sharedContainerSports = new Set<FootballSport>();\n";
    const cacheBlock = `${anchor}\n// Public sport tabs can trigger several worksheet reads at once. Cache successful\n// reads and share in-flight work so multiple visitors / tab switches do not each\n// consume the Google Sheets per-user read quota.\nconst SPORT_WORKSHEET_READ_CACHE_TTL_MS = 60_000;\nconst SPORT_WORKSHEET_READ_STALE_MS = 30 * 60_000;\n\ntype SportWorksheetCacheEntry = {\n  savedAt: number;\n  rows: SheetRow[];\n};\n\nconst sportWorksheetReadCache = new Map<string, SportWorksheetCacheEntry>();\nconst sportWorksheetReadInFlight = new Map<string, Promise<SheetRow[]>>();\n\nfunction sportWorksheetCacheKey(sport: FootballSport, worksheetName: string) {\n  return \`\${sport}|\${worksheetName}\`;\n}\n\nfunction copySportRows(rows: SheetRow[], columns?: string[]) {\n  return rows.map((source) => {\n    const row: SheetRow = { ...source };\n    for (const column of columns || []) {\n      if (row[column] === undefined) row[column] = \"\";\n    }\n    return row;\n  });\n}\n\nfunction isSheetsQuotaError(error: any) {\n  const code = Number(error?.code || error?.response?.status || 0);\n  const message = String(error?.message || error?.response?.data?.error?.message || \"\").toUpperCase();\n  return (\n    code === 429 ||\n    (code === 403 && (message.includes(\"QUOTA\") || message.includes(\"RATE LIMIT\"))) ||\n    message.includes(\"RATE_LIMIT_EXCEEDED\") ||\n    message.includes(\"QUOTA EXCEEDED\") ||\n    message.includes(\"READ REQUESTS PER MINUTE PER USER\")\n  );\n}\n\nfunction invalidateSportWorksheetReadCache(sport: FootballSport, worksheetName: string) {\n  sportWorksheetReadCache.delete(sportWorksheetCacheKey(sport, worksheetName));\n}\n`;
    text = replaceOnce(text, anchor, cacheBlock, "sport worksheet cache declarations");
  }

  if (!text.includes("const cached = sportWorksheetReadCache.get(key);")) {
    const replacement = `export async function readSportWorksheet(\n  sport: FootballSport,\n  worksheetName: string,\n  columns?: string[],\n): Promise<SheetRow[]> {\n  const key = sportWorksheetCacheKey(sport, worksheetName);\n  const now = Date.now();\n  const cached = sportWorksheetReadCache.get(key);\n\n  if (cached && now - cached.savedAt < SPORT_WORKSHEET_READ_CACHE_TTL_MS) {\n    return copySportRows(cached.rows, columns);\n  }\n\n  const active = sportWorksheetReadInFlight.get(key);\n  if (active) return copySportRows(await active, columns);\n\n  const operation = (async () => {\n    const spreadsheetId = await resolveSportSpreadsheetId(sport);\n    const sheets = await sheetsClient();\n    const physicalName = physicalWorksheetName(sport, worksheetName);\n    try {\n      const response = await sheets.spreadsheets.values.get({\n        spreadsheetId,\n        range: quoteSheetName(physicalName),\n      });\n      const rows = rowsToObjects((response.data.values || []) as string[][], columns);\n      sportWorksheetReadCache.set(key, { savedAt: Date.now(), rows: copySportRows(rows) });\n      return rows;\n    } catch (error: any) {\n      const code = Number(error?.code || error?.response?.status || 0);\n      const message = String(error?.message || \"\");\n      if (code === 400 && /unable to parse range|requested entity was not found/i.test(message)) {\n        sportWorksheetReadCache.set(key, { savedAt: Date.now(), rows: [] });\n        return [];\n      }\n      if (cached && Date.now() - cached.savedAt < SPORT_WORKSHEET_READ_STALE_MS && isSheetsQuotaError(error)) {\n        console.warn(\`Using stale \${sport} \${worksheetName} worksheet cache after Sheets quota error.\`);\n        return copySportRows(cached.rows, columns);\n      }\n      throw error;\n    }\n  })();\n\n  sportWorksheetReadInFlight.set(key, operation);\n  try {\n    return copySportRows(await operation, columns);\n  } finally {\n    if (sportWorksheetReadInFlight.get(key) === operation) {\n      sportWorksheetReadInFlight.delete(key);\n    }\n  }\n}\n`;
    text = replaceBetween(
      text,
      "export async function readSportWorksheet(",
      "\nasync function worksheetTitles",
      replacement,
      "cached sport worksheet reader",
    );
  }

  text = insertBeforeFunctionEnd(
    text,
    "export async function ensureSportWorksheet(",
    "\nexport async function writeSportWorksheet(",
    "  invalidateSportWorksheetReadCache(sport, worksheetName);\n",
    "ensure worksheet cache invalidation",
  );
  text = insertBeforeFunctionEnd(
    text,
    "export async function writeSportWorksheet(",
    "\nexport async function upsertSportRows(",
    "  invalidateSportWorksheetReadCache(sport, worksheetName);\n",
    "write worksheet cache invalidation",
  );

  fs.writeFileSync(path, text);
}

function patchFootballPublicData() {
  const path = "lib/footballPublicData.ts";
  let text = fs.readFileSync(path, "utf8");
  if (text.includes("FOOTBALL_PUBLIC_DATA_CACHE_TTL_MS")) return;

  text = replaceOnce(
    text,
    "export async function buildFootballPublicData(sport:FootballSport){",
    "async function buildFootballPublicDataFresh(sport:FootballSport,{persist=false}:{persist?:boolean}={}){",
    "rename football public builder",
  );
  text = replaceOnce(
    text,
    "  const today=todayET(); await Promise.all([ensureSportWorksheet(sport,\"all_game_trends\",ALL_GAME_TRENDS_HEADERS),ensureSportWorksheet(sport,\"public_split_snapshots\",PUBLIC_SPLIT_HEADERS)]);",
    "  const today=todayET(); if(persist) await Promise.all([ensureSportWorksheet(sport,\"all_game_trends\",ALL_GAME_TRENDS_HEADERS),ensureSportWorksheet(sport,\"public_split_snapshots\",PUBLIC_SPLIT_HEADERS)]);",
    "read-only football public requests",
  );
  text = replaceOnce(
    text,
    "  const currentSnapshots=enriched.map((split)=>snapshotRow({...split,snapshotTime:nowET()})); if(currentSnapshots.length) await upsertSportRows(sport,\"public_split_snapshots\",PUBLIC_SPLIT_HEADERS,currentSnapshots,snapshotKey);",
    "  const currentSnapshots=enriched.map((split)=>snapshotRow({...split,snapshotTime:nowET()})); if(persist&&currentSnapshots.length) await upsertSportRows(sport,\"public_split_snapshots\",PUBLIC_SPLIT_HEADERS,currentSnapshots,snapshotKey);",
    "scheduled football snapshot persistence",
  );
  text = replaceOnce(
    text,
    "  await upsertSportRows(sport,\"all_game_trends\",ALL_GAME_TRENDS_HEADERS,trendRows,trendRowKey);",
    "  if(persist) await upsertSportRows(sport,\"all_game_trends\",ALL_GAME_TRENDS_HEADERS,trendRows,trendRowKey);",
    "scheduled football trend persistence",
  );

  const marker = "\n// Small pure exports used by CI to guarantee football follows the MLB trend contract.";
  const wrapper = `\nconst FOOTBALL_PUBLIC_DATA_CACHE_TTL_MS = 60_000;\nconst FOOTBALL_PUBLIC_DATA_STALE_MS = 30 * 60_000;\ntype FootballPublicPayload = Awaited<ReturnType<typeof buildFootballPublicDataFresh>>;\ntype FootballPublicCacheEntry = { savedAt: number; data: FootballPublicPayload };\nconst footballPublicDataCache = new Map<FootballSport, FootballPublicCacheEntry>();\nconst footballPublicDataInFlight = new Map<string, Promise<FootballPublicPayload>>();\n\nexport async function buildFootballPublicData(\n  sport: FootballSport,\n  options: { forceFresh?: boolean; persist?: boolean } = {},\n) {\n  const forceFresh = options.forceFresh === true;\n  const persist = options.persist === true;\n  const cached = footballPublicDataCache.get(sport);\n  const now = Date.now();\n\n  if (!forceFresh && cached && now - cached.savedAt < FOOTBALL_PUBLIC_DATA_CACHE_TTL_MS) {\n    return cached.data;\n  }\n\n  const inFlightKey = \`\${sport}|\${persist ? \"persist\" : \"read\"}\`;\n  const active = footballPublicDataInFlight.get(inFlightKey);\n  if (active) return active;\n\n  const operation = (async () => {\n    try {\n      const data = await buildFootballPublicDataFresh(sport, { persist });\n      footballPublicDataCache.set(sport, { savedAt: Date.now(), data });\n      return data;\n    } catch (error) {\n      const fallback = footballPublicDataCache.get(sport);\n      if (fallback && Date.now() - fallback.savedAt < FOOTBALL_PUBLIC_DATA_STALE_MS) {\n        console.warn(\`Using last successful \${sport} public payload after refresh failure.\`, error);\n        return {\n          ...fallback.data,\n          stale: true,\n          warning: error instanceof Error ? error.message : String(error),\n          draftKings: fallback.data.draftKings\n            ? { ...fallback.data.draftKings, stale: true }\n            : fallback.data.draftKings,\n        } as FootballPublicPayload;\n      }\n      throw error;\n    }\n  })();\n\n  footballPublicDataInFlight.set(inFlightKey, operation);\n  try {\n    return await operation;\n  } finally {\n    if (footballPublicDataInFlight.get(inFlightKey) === operation) {\n      footballPublicDataInFlight.delete(inFlightKey);\n    }\n  }\n}\n`;
  text = replaceOnce(text, marker, `${wrapper}${marker}`, "football public response cache");
  fs.writeFileSync(path, text);
}

function patchRoute() {
  const path = "app/api/public-data/route.ts";
  let text = fs.readFileSync(path, "utf8");
  if (text.includes("scheduledFootball")) return;

  const oldBlock = `  if (requestedSport === "NFL" || requestedSport === "NCAAF") {\n    try {\n      return NextResponse.json(await buildFootballPublicData(requestedSport));`;
  const newBlock = `  if (requestedSport === "NFL" || requestedSport === "NCAAF") {\n    const scheduledFootball = ["1", "true", "yes"].includes(\n      String(request.nextUrl.searchParams.get("scheduled") || "").trim().toLowerCase(),\n    );\n    const forceFreshFootball =\n      scheduledFootball || request.nextUrl.searchParams.get("refresh") === "1";\n\n    // Only the authenticated scheduled capture is allowed to mutate football\n    // snapshot/trend worksheets. Normal visitors and manual refreshes are read-only.\n    if (scheduledFootball) {\n      const cronSecret = String(process.env.CRON_SECRET || "");\n      const authorization = String(request.headers.get("authorization") || "");\n      if (!cronSecret || authorization !== \`Bearer \${cronSecret}\`) {\n        return NextResponse.json({ ok: false, error: "Unauthorized scheduled football capture." }, { status: 401 });\n      }\n    }\n\n    try {\n      return NextResponse.json(\n        await buildFootballPublicData(requestedSport, {\n          forceFresh: forceFreshFootball,\n          persist: scheduledFootball,\n        }),\n      );`;
  text = replaceOnce(text, oldBlock, newBlock, "football route cache/persistence options");
  fs.writeFileSync(path, text);
}

function patchPage() {
  const path = "app/page.tsx";
  let text = fs.readFileSync(path, "utf8");
  if (text.includes("Clear the prior sport payload before loading the newly selected sport")) return;

  const oldBlock = `            onClick={() => {\n              setActiveSport(sport);\n              setActive("Today’s Best Plays");\n            }}`;
  const newBlock = `            onClick={() => {\n              // Clear the prior sport payload before loading the newly selected sport.\n              // This prevents an MLB stale response from being rendered under NFL/NCAAF\n              // when a sport-specific request is delayed or rate-limited.\n              if (sport !== activeSport) {\n                activeLoadControllerRef.current?.abort();\n                activeLoadRef.current = null;\n                setData(null);\n                setDraftKings(null);\n                setDraftKingsError("");\n                setError("");\n                setRefreshing(false);\n              }\n              setActiveSport(sport);\n              setActive("Today’s Best Plays");\n            }}`;
  text = replaceOnce(text, oldBlock, newBlock, "sport tab stale-payload guard");
  fs.writeFileSync(path, text);
}

patchSportSheets();
patchFootballPublicData();
patchRoute();
patchPage();
