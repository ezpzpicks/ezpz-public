import fs from "node:fs";

const boardPath = "app/FootballBoard.tsx";
let text = fs.readFileSync(boardPath, "utf8");

if (!text.includes("function slateIdentity(row: SheetRow)")) {
  const anchor = `function signedPct(value: unknown) {`;
  const helper = `function slateIdentity(row: SheetRow) {\n  const date = String(row.Date || row[\"Game Date\"] || \"\").trim();\n  const away = textKey(row[\"Away Team\"]);\n  const home = textKey(row[\"Home Team\"]);\n  if (date && away && home) return \`\${date}|\${away}|\${home}\`;\n  return textKey(row.Game || row[\"Game Key\"] || row[\"Game ID\"] || \"\");\n}\n\n`;
  if (!text.includes(anchor)) throw new Error("Could not find FootballBoard helper anchor");
  text = text.replace(anchor, helper + anchor);
}

if (!text.includes("function defaultStoredWeek(")) {
  const anchor = `function RecordTile({ label, value }: { label: string; value: RecordTotals | undefined }) {`;
  const helper = `function defaultStoredWeek(games: SheetRow[], today: string) {\n  const dated = [...games].filter((row) => row.Date && row.Week).sort((a, b) => String(a.Date).localeCompare(String(b.Date)));\n  const todayGame = dated.find((row) => String(row.Date) === today);\n  if (todayGame) return String(todayGame.Week || \"\");\n  const next = dated.find((row) => String(row.Date) > today);\n  if (next) return String(next.Week || \"\");\n  return dated.length ? String(dated[dated.length - 1].Week || \"\") : \"\";\n}\n\n`;
  if (!text.includes(anchor)) throw new Error("Could not find FootballBoard stored-week anchor");
  text = text.replace(anchor, helper + anchor);
}

const weeksBefore = `  const trendWeeks = useMemo(() => [...new Set(trends.map(weekLabel))].sort((a, b) => weekSort(a) - weekSort(b) || a.localeCompare(b)), [trends]);\n  const fallbackWeek = defaultWeek(trends, data.today);\n  const activeWeek = selectedWeek && trendWeeks.includes(selectedWeek) ? selectedWeek : fallbackWeek;\n  const filteredTrends = activeWeek ? trends.filter((play) => weekLabel(play) === activeWeek) : trends;`;
const weeksStrongElite = `  const trendWeeks = useMemo(() => [...new Set([\n    ...trends.map(weekLabel),\n    ...(weeklyData?.games || []).map((row) => String(row.Week || \"\").trim()).filter(Boolean),\n  ])].sort((a, b) => weekSort(a) - weekSort(b) || a.localeCompare(b)), [trends, weeklyData?.games]);\n  const fallbackWeek = defaultWeek(trends, data.today) || defaultStoredWeek(weeklyData?.games || [], data.today);\n  const activeWeek = selectedWeek && trendWeeks.includes(selectedWeek) ? selectedWeek : fallbackWeek;\n  const weekTrends = activeWeek ? trends.filter((play) => weekLabel(play) === activeWeek) : trends;\n  const filteredTrends = weekTrends.filter((play) => play.tier === \"Strong\" || play.tier === \"Elite\");\n  const storedGamesForWeek = (weeklyData?.games || []).filter((row) => !activeWeek || String(row.Week || \"\") === activeWeek);`;
const weeksAllFour = `  const trendWeeks = useMemo(() => [...new Set([\n    ...trends.map(weekLabel),\n    ...(weeklyData?.games || []).map((row) => String(row.Week || \"\").trim()).filter(Boolean),\n  ])].sort((a, b) => weekSort(a) - weekSort(b) || a.localeCompare(b)), [trends, weeklyData?.games]);\n  const fallbackWeek = defaultWeek(trends, data.today) || defaultStoredWeek(weeklyData?.games || [], data.today);\n  const activeWeek = selectedWeek && trendWeeks.includes(selectedWeek) ? selectedWeek : fallbackWeek;\n  const weekTrends = activeWeek ? trends.filter((play) => weekLabel(play) === activeWeek) : trends;\n  const filteredTrends = weekTrends;\n  const storedGamesForWeek = (weeklyData?.games || []).filter((row) => !activeWeek || String(row.Week || \"\") === activeWeek);`;
if (text.includes(weeksBefore)) text = text.replace(weeksBefore, weeksAllFour);
else if (text.includes(weeksStrongElite)) text = text.replace(weeksStrongElite, weeksAllFour);
else if (!text.includes("const filteredTrends = weekTrends;")) throw new Error("Could not patch weekly football all-four display policy");

text = text.replace(/const key = String\(row\["Game Key"\] \|\| row\["Game ID"\] \|\| row\.Game \|\| ""\);/g, "const key = slateIdentity(row);");

text = text.replace(
  `<div><strong>{activeWeek || "Waiting for DraftKings"}</strong><small>{displayedTrendGroups.length} games stored • games appear here as soon as DraftKings posts them</small></div>`,
  `<div><strong>{activeWeek || "Waiting for DraftKings"}</strong><small>{storedGamesForWeek.length} games stored • all 4 Spread/Total sides show with their live tier</small></div>`,
);
text = text.replace(
  `<div><strong>{activeWeek || "Waiting for DraftKings"}</strong><small>{storedGamesForWeek.length} games stored • Strong/Elite trend plays surface automatically</small></div>`,
  `<div><strong>{activeWeek || "Waiting for DraftKings"}</strong><small>{storedGamesForWeek.length} games stored • all 4 Spread/Total sides show with their live tier</small></div>`,
);

const emptyBefore = `{displayedTrendGroups.length ? <div className="trendGameGrid">{displayedTrendGroups.map((group) => <TrendGameCard key={group.plays[0]?.gameKey || group.game} game={group.game} plays={group.plays} />)}</div> : <div className="fbEmpty">No {sport} DraftKings Spread/Total markets are stored for {activeWeek || "this week"} yet.</div>}`;
const emptyStrongElite = `{displayedTrendGroups.length ? <div className="trendGameGrid">{displayedTrendGroups.map((group) => <TrendGameCard key={group.plays[0]?.gameKey || group.game} game={group.game} plays={group.plays} />)}</div> : <div className="fbEmpty">No Strong/Elite {sport} Trend Plays for {activeWeek || "this week"} yet. {storedGamesForWeek.length ? storedGamesForWeek.length + " DraftKings-posted games are already stored and being tracked." : "Games will appear automatically as DraftKings posts them."}</div>}`;
const emptyAllFour = `{displayedTrendGroups.length ? <div className="trendGameGrid">{displayedTrendGroups.map((group) => <TrendGameCard key={group.plays[0]?.gameKey || group.game} game={group.game} plays={group.plays} />)}</div> : <div className="fbEmpty">No {sport} DraftKings Spread/Total markets are stored for {activeWeek || "this week"} yet. Pass, Good, Strong, and Elite rows all display once the market is stored.</div>}`;
if (text.includes(emptyBefore)) text = text.replace(emptyBefore, emptyAllFour);
else if (text.includes(emptyStrongElite)) text = text.replace(emptyStrongElite, emptyAllFour);

if (text.includes('play.tier === "Strong" || play.tier === "Elite"')) throw new Error("Strong/Elite-only football display filter is still present");
if (!text.includes("const filteredTrends = weekTrends;")) throw new Error("All-four weekly football display policy did not apply");
if (!text.includes("const key = slateIdentity(row);")) throw new Error("Full Slate matchup dedupe did not apply");

fs.writeFileSync(boardPath, text);

// Keep the weekly football discovery aligned with the event-group IDs already
// proven by the live football public-data collector. The previous weekly code
// queried literal labels (NFL / College Football / NCAAF / CFB), which can return
// zero rows even while DraftKings has football splits posted.
const marketPath = "lib/footballWeeklyMarket.ts";
let market = fs.readFileSync(marketPath, "utf8");
const oldGroups = '  const groups = sport === "NFL" ? ["NFL"] : ["College Football", "NCAAF", "CFB"];';
const provenGroups = '  const groups = sport === "NFL" ? ["42648"] : ["88808", "94682", "212333"];';
if (market.includes(oldGroups)) market = market.replace(oldGroups, provenGroups);
else if (!market.includes(provenGroups)) throw new Error("Could not align weekly football DraftKings event groups");

const oldHorizons = '    for (const horizon of ["n7days", ""]) {';
const robustHorizons = '    for (const horizon of sport === "NFL" ? ["n7days", "n30days", ""] : ["n30days", "n7days", ""]) {';
if (market.includes(oldHorizons)) market = market.replace(oldHorizons, robustHorizons);
else if (!market.includes(robustHorizons)) throw new Error("Could not align weekly football DraftKings date windows");

if (!market.includes(provenGroups)) throw new Error("Weekly football DraftKings event-group fix did not apply");
fs.writeFileSync(marketPath, market);

console.log("Weekly football UI now shows all four sides (including Pass) and weekly discovery uses the proven NFL/CFB DraftKings event groups.");
