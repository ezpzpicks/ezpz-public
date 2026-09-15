from pathlib import Path
import re

path = Path("app/FootballBoard.tsx")
text = path.read_text()


def sub_once(pattern: str, replacement: str, label: str):
    global text
    text, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected one replacement, got {count}")


sub_once(
    r"function formBadge\(.*?\n\}\n\n(?=function PlayerHeadshot)",
    "",
    "remove formBadge",
)

new_ezpz_components = r'''function ezpzTextKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function ezpzPickIsFinal(pick: NflEzpzPick, data: FootballData) {
  if (pick.source !== "Trend Play") return true;
  if (String(pick.snapshotStatus || "").toUpperCase() === "FINAL_PREGAME") return true;
  const trendPlays = (data as FootballData & { trendPlays?: Array<Record<string, unknown>> }).trendPlays || [];
  const pickGame = ezpzTextKey(pick.game);
  const pickMarket = ezpzTextKey(pick.market);
  const pickSide = ezpzTextKey(pick.selection).startsWith("under") ? "under" : ezpzTextKey(pick.selection).startsWith("over") ? "over" : "";
  const pickTeam = ezpzTextKey(String(pick.selection || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""));
  const match = trendPlays.find((play) => {
    if (ezpzTextKey(play.game) !== pickGame || ezpzTextKey(play.market) !== pickMarket) return false;
    if (pickMarket === "total") return ezpzTextKey(play.side || play.selection) === pickSide;
    const trendTeam = ezpzTextKey(play.selectionTeam || play.selection);
    return Boolean(pickTeam && trendTeam && (pickTeam === trendTeam || pickTeam.includes(trendTeam) || trendTeam.includes(pickTeam)));
  });
  return String(match?.snapshotStatus || "").toUpperCase() === "FINAL_PREGAME";
}
function FootballEzpzCard({ pick, sport, data }: { pick: NflEzpzPick; sport: Sport; data: FootballData }) {
  const isProp = pick.market === "Player Prop" || Boolean(pick.playerName);
  const final = ezpzPickIsFinal(pick, data);
  const propPick = [String(pick.propSide || "").trim(), String(pick.propLine ?? "").trim()].filter(Boolean).join(" ") || pick.selection;
  return (
    <article className={`nflEzpzCard ${isProp ? "prop" : ""}`}>
      <div className="nflEzpzTop"><div className="nflEzpzBadges"><span className={`nflStatusBadge ${final ? "final" : "pending"}`}>{final ? "FINAL" : "PENDING"}</span></div><strong className="nflEzpzOdds">{displayOdds(pick.odds)}</strong></div>
      {isProp ? (
        <>
          <div className="nflPlayerHero compactHero"><PlayerHeadshot play={pick} compact /><div><span className="nflEyebrow"><TeamLogoName sport="NFL" team={pick.playerTeam || ""} text={pick.playerTeam || "NFL"} compact /> • {pick.propMarket || "Player Prop"}</span><h3>{pick.playerName || pick.selection}</h3><p><MatchupWithLogos sport="NFL" game={pick.game || ""} compact /></p></div></div>
          <div className="nflPropPickLine"><span>Pick</span><strong>{propPick}</strong></div>
        </>
      ) : (
        <div className="nflEzpzSelection"><span><MatchupWithLogos sport={sport} game={pick.game || ""} compact /></span><h3><SelectionWithTeamLogo sport={sport} selection={pick.selection || ""} game={pick.game || ""} /></h3><p>{pick.market}</p></div>
      )}
    </article>
  );
}
function FootballEzpzPicks({ sport, data }: { sport: Sport; data: FootballData }) {
  const picks = data.aiPicks || [];
  return (
    <section className="nflOptimizedSection">
      <div className="nflOptimizedHead"><div><h2>{sport} EZPZ Picks</h2></div><span>{picks.length} picks</span></div>
      {picks.length ? <div className="nflEzpzStack">{picks.map((pick, index) => <FootballEzpzCard key={`${pick.game}-${pick.market}-${pick.selection}-${index}`} pick={pick} sport={sport} data={data} />)}</div> : <div className="nflOptimizedEmpty">No {sport} EZPZ Picks right now.</div>}
    </section>
  );
}

'''
sub_once(
    r"function sourceLabel\(.*?\n\}\nfunction NflEzpzCard\(.*?\n\}\nfunction NflEzpzPicks\(.*?\n\}\n\n(?=function fallbackTotals)",
    new_ezpz_components,
    "replace EZPZ components",
)

ezpz_history_helpers = r'''function ezpzGradeBucket(row: SheetRow) {
  const grade = ezpzTextKey(row.Grade || row["Model Grade"] || row.Tier || "");
  if (grade === "a" || grade.startsWith("a ")) return "A";
  if (grade === "b" || grade.startsWith("b ")) return "B";
  return "";
}
function ezpzMarketLine(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\d+(?:\.\d+)?/g) || [];
  for (const raw of [...matches].reverse()) {
    const line = Number(raw);
    if (Number.isFinite(line) && Math.abs(line) <= 60) return line;
  }
  return null;
}
function ezpzSide(value: unknown) {
  const key = ezpzTextKey(value);
  if (key.startsWith("under")) return "Under";
  if (key.startsWith("over")) return "Over";
  return "";
}
function ezpzModelRecordType(row: SheetRow, sport: Sport) {
  const grade = ezpzGradeBucket(row);
  if (!grade) return "";
  if (sport === "NFL" && isNflPlayerPropRow(row)) {
    const market = ezpzTextKey(row.Market || row["Bet Type"] || "Player Prop");
    const side = ezpzSide(row.Pick || row.Side || row.Selection);
    return market && side ? `${grade}|PROP|${market}|${side}` : "";
  }
  const market = ezpzTextKey(row["Bet Type"] || row.Market);
  if (market.includes("total")) {
    const side = ezpzSide(row.Selection || row.Side || row.Pick);
    return side ? `${grade}|TOTAL|${side}` : "";
  }
  if (market.includes("spread")) {
    const line = ezpzMarketLine(row.Selection) ?? ezpzMarketLine(row.Line) ?? ezpzMarketLine(row["Odds/Line"]);
    if (line == null || Math.abs(line) < 1e-9) return "";
    return `${grade}|SPREAD|${line < 0 ? "Favorite" : "Underdog"}`;
  }
  return "";
}
function ezpzModelHistoryRows(rows: SheetRow[], sport: Sport) {
  const settled = rows
    .map((row, index) => ({ row, index, date: signalIsoDate(row.Date || row["Game Date"] || ""), type: ezpzModelRecordType(row, sport) }))
    .filter((item) => Boolean(item.date && item.type && resultCode(item.row.Result || item.row.Status)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
  const dates = [...new Set(settled.map((item) => item.date))];
  const priorByType = new Map<string, SheetRow[]>();
  const picks: SheetRow[] = [];
  for (const date of dates) {
    const day = settled.filter((item) => item.date === date);
    for (const item of day) {
      const prior = priorByType.get(item.type) || [];
      const lastSeven = prior.slice(-7);
      const form = recordTotalsFromRows(lastSeven);
      if (form.totalBets === 7 && form.wins >= 5 && rowAmericanOdds(item.row) >= -150) picks.push(item.row);
    }
    for (const item of day) {
      const prior = priorByType.get(item.type) || [];
      prior.push(item.row);
      priorByType.set(item.type, prior);
    }
  }
  return picks;
}
function ezpzTrendDetails(row: SheetRow): Record<string, any> | null {
  const raw = String(row["Trend Score Details"] || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function ezpzTrendSignalRoi(signal: Record<string, any>) {
  const records = signal?.records;
  if (!records?.allTime || !records?.last30 || !records?.last7) return null;
  const last7Decisions = Number(records.last7.wins || 0) + Number(records.last7.losses || 0);
  const last7Weight = Math.min(0.5, Math.max(0, last7Decisions) * 0.1);
  const carry = (0.5 - last7Weight) / 2;
  const windows = [
    { row: records.allTime, weight: 0.25 + carry },
    { row: records.last30, weight: 0.25 + carry },
    { row: records.last7, weight: last7Weight },
  ].filter((item) => Number(item.row.totalBets || 0) > 0 && item.weight > 0);
  if (!windows.length) return null;
  const totalWeight = windows.reduce((sum, item) => sum + item.weight, 0);
  return windows.reduce((sum, item) => sum + Number(item.row.roiPct || 0) * item.weight, 0) / totalWeight;
}
function ezpzTrendRoi(details: Record<string, any> | null) {
  const signals = Array.isArray(details?.signals) ? details.signals as Array<Record<string, any>> : [];
  const values = signals.map(ezpzTrendSignalRoi).filter((value): value is number => value != null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function ezpzCfbTrendHistoryRows(rows: SheetRow[]) {
  const settled = rows
    .map((row, index) => ({ row, index, details: ezpzTrendDetails(row) }))
    .filter((item) => Boolean(resultCode(item.row.Result || item.row.Status)) && ezpzTextKey(item.row["Trend Play"]) !== "false")
    .map((item) => ({
      ...item,
      date: signalIsoDate(item.row.Date || item.row["Game Date"] || ""),
      game: ezpzTextKey(item.row.Game || item.row["Game Key"] || ""),
      market: ezpzTextKey(item.row.Market || item.details?.market || ""),
      selection: ezpzTextKey(item.row.Selection || item.row.Side || item.details?.selection || item.details?.side || ""),
      tier: String(item.details?.tier || item.row["Trend Tier"] || ""),
      score: Number(item.details?.score ?? item.row["Trend Score"] ?? 0),
      sample: Number(item.details?.TrendSampleSize ?? item.row["Trend Sample Size"] ?? 0),
      roi: ezpzTrendRoi(item.details),
    }))
    .filter((item) => Boolean(item.date && item.game && item.market));
  const qualified: typeof settled = [];
  for (const item of settled) {
    if (item.tier !== "Strong" && item.tier !== "Elite") continue;
    if (item.sample < 8 || item.roi == null || item.roi <= 0 || rowAmericanOdds(item.row) < -150) continue;
    const signals = Array.isArray(item.details?.signals) ? item.details.signals as Array<Record<string, any>> : [];
    if (!signals.length || !signals.every((signal) => Number(signal?.records?.allTime?.wins || 0) > Number(signal?.records?.allTime?.losses || 0))) continue;
    const peers = settled.filter((peer) => peer.date === item.date && peer.game === item.game && peer.market === item.market);
    const maxScore = Math.max(...peers.map((peer) => Number(peer.score || 0)));
    if (Number(item.score || 0) + 1e-9 < maxScore) continue;
    const opponents = peers.filter((peer) => peer.selection !== item.selection && peer.roi != null).map((peer) => Number(peer.roi));
    if (!opponents.length) continue;
    const opposingRoi = Math.max(...opponents);
    if (item.roi - opposingRoi < 25) continue;
    qualified.push(item);
  }
  const byGame = new Map<string, (typeof qualified)[number]>();
  for (const item of qualified.sort((a, b) => b.score - a.score || a.index - b.index)) {
    const key = `${item.date}|${item.game}`;
    if (!byGame.has(key)) byGame.set(key, item);
  }
  return [...byGame.values()].map((item) => item.row);
}
function ezpzHistoryKey(row: SheetRow) {
  const date = signalIsoDate(row.Date || row["Game Date"] || "");
  const game = ezpzTextKey(row.Game || row["Game Key"] || "");
  const market = ezpzTextKey(row.Market || row["Bet Type"] || "");
  if (String(row.Player || "").trim()) {
    const player = ezpzTextKey(row.Player);
    const propMarket = ezpzTextKey(row.Market || row["Bet Type"]);
    const side = ezpzTextKey(ezpzSide(row.Pick || row.Side || row.Selection));
    const line = String(row["Market Line"] || row.Line || row["Prop Line"] || "").trim();
    return `${date}|${game}|prop|${player}|${propMarket}|${side}|${line}`;
  }
  if (market.includes("total")) return `${date}|${game}|total|${ezpzTextKey(ezpzSide(row.Selection || row.Side || row.Pick))}`;
  const team = ezpzTextKey(String(row.Selection || row.Pick || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, ""));
  return `${date}|${game}|spread|${team}`;
}
function footballEzpzHistoryRows(data: FootballData, sport: Sport) {
  const modelRows = ezpzModelHistoryRows(data.betTrackerRows || [], sport);
  const trendRows = sport === "NCAAF" ? ezpzCfbTrendHistoryRows(data.trendRecordRows || []) : [];
  const merged = new Map<string, SheetRow>();
  for (const row of [...modelRows, ...trendRows]) {
    const key = ezpzHistoryKey(row);
    if (key && !merged.has(key)) merged.set(key, row);
  }
  return [...merged.values()].sort((a, b) => signalIsoDate(a.Date || a["Game Date"] || "").localeCompare(signalIsoDate(b.Date || b["Game Date"] || "")));
}

'''
anchor = "function isNflPlayerPropRow(row: SheetRow) {"
if text.count(anchor) != 1:
    raise SystemExit(f"insert EZPZ history helpers: expected one anchor, got {text.count(anchor)}")
text = text.replace(anchor, ezpz_history_helpers + anchor, 1)

old_records_setup = '''  const trackerRows = data.betTrackerRows || [];
  const nflPropRecord = sport === "NFL" ? recordTotalsFromRows(trackerRows.filter(isNflPlayerPropRow)) : null;'''
new_records_setup = '''  const trackerRows = data.betTrackerRows || [];
  const ezpzRows = footballEzpzHistoryRows(data, sport);
  const ezpzOverall = recordTotalsFromRows(ezpzRows);
  const ezpzLast7 = recordTotalsFromRows(ezpzRows.filter((row) => signalDateWithin(row.Date || row["Game Date"] || "", data.today || "", 7)));
  const nflPropRecord = sport === "NFL" ? recordTotalsFromRows(trackerRows.filter(isNflPlayerPropRow)) : null;'''
if old_records_setup not in text:
    raise SystemExit("records setup anchor not found")
text = text.replace(old_records_setup, new_records_setup, 1)

old_model_grid = '''        <div className="qualifiedGrid">
          <RecordTile label="Model Plays - Last 7 Days" value={last7} />
          <RecordTile label="Model Plays - Running Total" value={overall} />
          {nflPropRecord ? <RecordTile label="NFL Player Props - Running Total" value={nflPropRecord} /> : null}
        </div>'''
new_model_grid = '''        <div className="qualifiedGrid">
          <RecordTile label="Model Plays - Last 7 Days" value={last7} />
          <RecordTile label="Model Plays - Running Total" value={overall} />
          {nflPropRecord ? <RecordTile label="NFL Player Props - Running Total" value={nflPropRecord} /> : null}
        </div>
        <div className="sectionHead"><div><h2>{sport} EZPZ Pick Records</h2></div></div>
        <div className="qualifiedGrid">
          <RecordTile label="EZPZ Picks - Last 7 Days" value={ezpzLast7} />
          <RecordTile label="EZPZ Picks - Running Total" value={ezpzOverall} />
        </div>'''
if old_model_grid not in text:
    raise SystemExit("record tile grid anchor not found")
text = text.replace(old_model_grid, new_model_grid, 1)

old_route = '''  if (tab === "Records") return <FootballRecords sport={sport} data={data} />;
  if (sport !== "NFL" || tab !== "EZPZ Picks") {
    return <FootballBoardBase sport={sport} tab={tab} data={data as any} />;
  }
  return (
    <>
      <NflEzpzPicks data={data} />'''
new_route = '''  if (tab === "Records") return <FootballRecords sport={sport} data={data} />;
  if (tab !== "EZPZ Picks") {
    return <FootballBoardBase sport={sport} tab={tab} data={data as any} />;
  }
  return (
    <>
      <FootballEzpzPicks sport={sport} data={data} />'''
if old_route not in text:
    raise SystemExit("EZPZ route anchor not found")
text = text.replace(old_route, new_route, 1)

path.write_text(text)
