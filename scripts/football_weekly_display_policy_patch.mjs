import fs from "node:fs";

const path = "app/FootballBoard.tsx";
let text = fs.readFileSync(path, "utf8");

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
const weeksAfter = `  const trendWeeks = useMemo(() => [...new Set([\n    ...trends.map(weekLabel),\n    ...(weeklyData?.games || []).map((row) => String(row.Week || \"\").trim()).filter(Boolean),\n  ])].sort((a, b) => weekSort(a) - weekSort(b) || a.localeCompare(b)), [trends, weeklyData?.games]);\n  const fallbackWeek = defaultWeek(trends, data.today) || defaultStoredWeek(weeklyData?.games || [], data.today);\n  const activeWeek = selectedWeek && trendWeeks.includes(selectedWeek) ? selectedWeek : fallbackWeek;\n  const weekTrends = activeWeek ? trends.filter((play) => weekLabel(play) === activeWeek) : trends;\n  const filteredTrends = weekTrends.filter((play) => play.tier === \"Strong\" || play.tier === \"Elite\");\n  const storedGamesForWeek = (weeklyData?.games || []).filter((row) => !activeWeek || String(row.Week || \"\") === activeWeek);`;
if (text.includes(weeksBefore)) text = text.replace(weeksBefore, weeksAfter);
else if (!text.includes("const storedGamesForWeek")) throw new Error("Could not patch weekly football Strong/Elite policy");

text = text.replace(/const key = String\(row\["Game Key"\] \|\| row\["Game ID"\] \|\| row\.Game \|\| ""\);/g, "const key = slateIdentity(row);");

text = text.replace(
  `<div><strong>{activeWeek || "Waiting for DraftKings"}</strong><small>{displayedTrendGroups.length} games stored • games appear here as soon as DraftKings posts them</small></div>`,
  `<div><strong>{activeWeek || "Waiting for DraftKings"}</strong><small>{storedGamesForWeek.length} games stored • Strong/Elite trend plays surface automatically</small></div>`,
);

const emptyBefore = `{displayedTrendGroups.length ? <div className="trendGameGrid">{displayedTrendGroups.map((group) => <TrendGameCard key={group.plays[0]?.gameKey || group.game} game={group.game} plays={group.plays} />)}</div> : <div className="fbEmpty">No {sport} DraftKings Spread/Total markets are stored for {activeWeek || "this week"} yet.</div>}`;
const emptyAfter = `{displayedTrendGroups.length ? <div className="trendGameGrid">{displayedTrendGroups.map((group) => <TrendGameCard key={group.plays[0]?.gameKey || group.game} game={group.game} plays={group.plays} />)}</div> : <div className="fbEmpty">No Strong/Elite {sport} Trend Plays for {activeWeek || "this week"} yet. {storedGamesForWeek.length ? storedGamesForWeek.length + " DraftKings-posted games are already stored and being tracked." : "Games will appear automatically as DraftKings posts them."}</div>}`;
text = text.replace(emptyBefore, emptyAfter);

if (!text.includes('play.tier === "Strong" || play.tier === "Elite"')) throw new Error("Strong/Elite weekly display policy did not apply");
if (!text.includes("const key = slateIdentity(row);")) throw new Error("Full Slate matchup dedupe did not apply");

fs.writeFileSync(path, text);
console.log("Weekly football UI now stores all posted games, surfaces only Strong/Elite trend plays, and dedupes Full Slate by matchup.");
