"use client";

import { useEffect, useMemo, useState } from "react";

type RecordTotals = {
  label: string;
  record: string;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
  wins: number;
  losses: number;
  pushes: number;
};
type Summary = {
  betType: string;
  status: "WINNING" | "EVEN" | "LOSING";
  wins: number;
  losses: number;
  pushes: number;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
};
type Play = {
  playType: string;
  game: string;
  play: string;
  oddsLine: string;
  score: string | number;
  isGreen: boolean;
  awayTeam: string;
  homeTeam: string;
  headshotUrl?: string;
};
type SheetRow = Record<string, string>;
type ApiData = {
  ok: boolean;
  error?: string;
  today: string;
  lastUpdated: string;
  tiles: {
    last7Days: RecordTotals;
    overallGreen: RecordTotals;
    pendingGreen: number;
    bestPlaysToday: number;
  };
  bestPlays: Play[];
  slateToday: SheetRow[];
  recordSummary: Summary[];
  last7RecordSummary: Summary[];
};

type Tab = "Today’s Best Plays" | "Full Slate" | "Records";
const TABS: Tab[] = ["Today’s Best Plays", "Full Slate", "Records"];
const BUILD_LABEL = "BUILD v10-current-look";

const GLOBAL_CSS = `
:root {
  --bg: #050914;
  --panel: #0f172a;
  --panel2: #111c2f;
  --bubble: rgba(30, 41, 59, 0.88);
  --bubble2: rgba(15, 23, 42, 0.74);
  --line: rgba(148, 163, 184, 0.2);
  --line2: rgba(59, 130, 246, 0.22);
  --text: #f8fafc;
  --muted: #94a3b8;
  --soft: #cbd5e1;
  --green: #22c55e;
  --blue: #38bdf8;
  --yellow: #f59e0b;
  --red: #ef4444;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.32), transparent 32rem),
    radial-gradient(circle at 82% 12%, rgba(34, 197, 94, 0.12), transparent 22rem),
    linear-gradient(180deg, #050914 0%, #08111f 55%, #050914 100%);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
}
button { font: inherit; }
.shell { width: min(980px, calc(100% - 28px)); margin: 0 auto; padding: 22px 0 42px; }
.hero { text-align: center; padding: 8px 0 18px; }
.logoWrap {
  width: 112px; height: 112px; margin: 0 auto 13px; display: grid; place-items: center; border-radius: 999px;
  background: radial-gradient(circle, rgba(56,189,248,.18), rgba(15,23,42,.92) 64%);
  border: 1px solid rgba(125,211,252,.34);
  box-shadow: 0 0 34px rgba(56,189,248,.28), 0 0 72px rgba(37,99,235,.13), inset 0 0 22px rgba(255,255,255,.06);
  position: relative;
}
.logoWrap:after { content:""; position:absolute; inset:-12px; border-radius:999px; background:radial-gradient(circle, rgba(56,189,248,.16), transparent 66%); filter: blur(8px); z-index:-1; }
.logo { width: 82px; height: 82px; object-fit: contain; border-radius: 999px; }
.logoFallback { position:absolute; font-size:28px; font-weight:950; letter-spacing:-2px; color:#dbeafe; }
h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.8rem); line-height: .96; letter-spacing: -.075em; }
.heroSub { max-width: 680px; margin: 11px auto 0; color: var(--soft); line-height: 1.45; font-weight: 650; }
.versionPill { display:inline-flex; margin-top: 8px; padding: 5px 10px; border-radius: 999px; background: rgba(15,23,42,.72); border:1px solid rgba(56,189,248,.22); color:#93c5fd; font-size:.68rem; font-weight:950; letter-spacing:.06em; }

.tileGrid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 14px 0 16px; }
.tile { background: linear-gradient(135deg, rgba(15,23,42,.96), rgba(17,24,39,.9)); border:1px solid var(--line); border-radius: 20px; padding: 14px 15px; box-shadow: 0 16px 44px rgba(0,0,0,.24); }
.tile.green { border-color: rgba(34,197,94,.48); box-shadow: 0 16px 48px rgba(34,197,94,.09); }
.tileLabel { color: var(--muted); font-size: .68rem; font-weight: 950; letter-spacing:.08em; text-transform: uppercase; }
.tileValue { margin-top: 7px; font-size: 1.55rem; line-height: 1; font-weight: 950; letter-spacing:-.04em; }
.tileMeta { margin-top: 6px; color: var(--soft); font-size: .78rem; font-weight: 750; }
.tabs { position: sticky; top:0; z-index: 10; display:flex; justify-content:center; gap:8px; padding: 12px 0; backdrop-filter: blur(16px); }
.tabBtn { cursor:pointer; border:1px solid rgba(148,163,184,.18); background: rgba(15,23,42,.74); color:#dbeafe; border-radius:999px; padding: 10px 14px; font-weight: 950; transition: .16s ease; }
.tabBtn:hover { transform: translateY(-1px); border-color: rgba(56,189,248,.44); }
.tabBtn.active { background: linear-gradient(135deg, rgba(37,99,235,.95), rgba(14,165,233,.82)); border-color: rgba(125,211,252,.54); box-shadow: 0 10px 28px rgba(37,99,235,.24); }
.sectionHead { display:flex; justify-content:space-between; gap: 16px; align-items:flex-end; margin: 18px 0 12px; }
.sectionHead h2 { margin:0; font-size: clamp(1.25rem, 3.6vw, 2rem); letter-spacing:-.04em; }
.sectionHead p { margin: 5px 0 0; color: var(--muted); font-weight: 700; line-height:1.35; }
.cards { display:grid; grid-template-columns: 1fr; gap: 12px; }
.card { position:relative; overflow:hidden; background: linear-gradient(135deg, rgba(15,23,42,.97), rgba(17,24,39,.92)); border:1px solid var(--line); border-radius: 21px; padding: 16px; box-shadow: 0 18px 52px rgba(0,0,0,.28); }
.card.green { border-left: 6px solid var(--green); border-top-color: rgba(34,197,94,.25); }
.card:before { content:""; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent, rgba(125,211,252,.28), transparent); }
.rankBadge { width:34px; height:34px; display:grid; place-items:center; border-radius:999px; background: rgba(34,197,94,.18); border:1px solid rgba(34,197,94,.48); color:#bbf7d0; font-weight: 950; }
.cardTop { display:flex; justify-content:space-between; align-items:flex-start; gap: 12px; }
.cardTitle { font-size: 1rem; font-weight: 950; letter-spacing:-.02em; text-transform: uppercase; }
.cardSub { margin-top:4px; color:var(--soft); font-size:.83rem; font-weight: 700; }
.scorePill { display:inline-flex; align-items:center; padding:7px 10px; border-radius:999px; background: rgba(34,197,94,.16); border:1px solid rgba(34,197,94,.42); color:#dcfce7; font-size:.74rem; font-weight: 950; text-transform: uppercase; white-space:nowrap; }
.teamRow { display:grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items:center; margin: 12px 0; }
.teamSide { display:flex; align-items:center; gap:9px; min-width:0; }
.teamSide.home { justify-content:flex-end; text-align:right; }
.teamName { font-weight: 950; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.vsText { width:32px; height:26px; display:grid; place-items:center; border-radius:999px; border:1px solid rgba(59,130,246,.44); background:rgba(37,99,235,.2); color:#bfdbfe; font-size:.68rem; font-weight:950; }
.teamLogo { width:38px; height:38px; object-fit:contain; filter: drop-shadow(0 6px 10px rgba(0,0,0,.3)); }
.playMain { display:flex; align-items:center; gap: 12px; margin: 10px 0 0; }
.headshot, .headshotFallback { width:52px; height:52px; flex:0 0 52px; border-radius:999px; object-fit:cover; border:1px solid rgba(148,163,184,.26); background: rgba(255,255,255,.08); }
.headshotFallback { display:grid; place-items:center; font-weight:950; color:#dbeafe; background:linear-gradient(135deg, rgba(37,99,235,.34), rgba(15,23,42,.72)); }
.playName { font-size: 1.05rem; font-weight: 950; letter-spacing:-.02em; }
.playDetail { color: var(--soft); font-size:.82rem; font-weight: 700; margin-top: 2px; }
.bubbleGrid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; margin-top: 12px; }
.miniBubble { border:1px solid rgba(148,163,184,.18); border-radius: 13px; padding: 9px 10px; background: rgba(30,41,59,.72); min-width:0; }
.miniBubble.green { background: rgba(34,197,94,.15); border-color: rgba(34,197,94,.45); }
.miniLabel { color:#93c5fd; font-size:.6rem; font-weight:950; letter-spacing:.08em; text-transform:uppercase; }
.miniValue { margin-top:5px; color:#f8fafc; font-size:.9rem; font-weight:950; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.marketStack { display:grid; gap:8px; margin-top: 10px; }
.marketBubble { width:100%; border:1px solid rgba(148,163,184,.18); border-radius: 13px; padding: 9px 11px; background: rgba(30,41,59,.68); font-size:.82rem; font-weight: 800; color:#f8fafc; }
.marketBubble.green { background:rgba(34,197,94,.15); border-color:rgba(34,197,94,.43); color:#dcfce7; }
.pitcherGrid { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 11px; }
.pitcherBox { background: rgba(30,41,59,.64); border:1px solid rgba(148,163,184,.17); border-radius: 16px; padding: 10px; }
.pitcherHeader { display:flex; align-items:center; gap: 10px; margin-bottom: 8px; }
.pitcherLabel { color:#dbeafe; font-weight: 950; font-size:.84rem; }
.pitcherNameSmall { color:#f8fafc; font-weight: 950; font-size:.95rem; }
.tableWrap { overflow:auto; border:1px solid var(--line); border-radius: 18px; background: rgba(15,23,42,.76); }
table { width:100%; border-collapse: collapse; min-width: 680px; }
th, td { padding: 11px 12px; border-bottom:1px solid rgba(148,163,184,.12); text-align:left; font-size:.86rem; }
th { color:#93c5fd; font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; }
.chip { display:inline-flex; border-radius:999px; padding:5px 9px; font-size:.7rem; font-weight:950; text-transform:uppercase; }
.chip.green { background:#dcfce7; color:#166534; }
.chip.yellow { background:#fef3c7; color:#92400e; }
.chip.red { background:#fee2e2; color:#991b1b; }
.empty, .error { border:1px dashed rgba(148,163,184,.28); border-radius:18px; padding:22px; text-align:center; color:var(--soft); background:rgba(15,23,42,.56); font-weight:750; }
.error { color:#fecaca; border-color:rgba(239,68,68,.35); }
@media (max-width: 760px) {
  .shell { width: min(100% - 18px, 980px); padding-top: 12px; }
  .tileGrid { grid-template-columns:1fr; }
  .teamRow { grid-template-columns: 1fr auto 1fr; gap: 6px; }
  .teamLogo { width:30px; height:30px; }
  .teamName { font-size:.82rem; }
  .bubbleGrid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .pitcherGrid { grid-template-columns:1fr; }
  .tabs { overflow-x:auto; justify-content:flex-start; }
  .tabBtn { white-space:nowrap; }
}
`;

function statusClass(wins: number, losses: number) {
  if (wins > losses) return "green";
  if (wins === losses) return "yellow";
  return "red";
}

function Tile({ label, value, meta, green }: { label: string; value: string; meta: string; green?: boolean }) {
  return (
    <div className={`tile ${green ? "green" : ""}`}>
      <div className="tileLabel">{label}</div>
      <div className="tileValue">{value}</div>
      <div className="tileMeta">{meta}</div>
    </div>
  );
}

function normalizeType(value: string) {
  const text = String(value || "").toUpperCase();
  if (text.includes("STRONG OVER")) return "STRONG OVER";
  if (text.includes("LEAN OVER")) return "LEAN OVER";
  if (/\bOVER\b/.test(text)) return "OVER";
  if (text.includes("STRONG UNDER")) return "STRONG UNDER";
  if (text.includes("LEAN UNDER")) return "LEAN UNDER";
  if (/\bUNDER\b/.test(text)) return "UNDER";
  if (text.includes("ELITE NRFI")) return "ELITE NRFI";
  if (text.includes("STRONG NRFI")) return "STRONG NRFI";
  if (text.includes("LEAN NRFI")) return "LEAN NRFI";
  if (text.includes("YRFI")) return "YRFI";
  if (text === "NRFI" || text.includes(" NRFI")) return "NRFI";
  if (text.includes("A MONEYLINE")) return "A MONEYLINE";
  if (text.includes("B MONEYLINE")) return "B MONEYLINE";
  if (text.includes("NON-EDGE MONEYLINE")) return "NON-EDGE MONEYLINE";
  if (text.includes("PASS")) return "PASS";
  return text.trim();
}

const TEAM_ABBR: Record<string, string> = {
  "Arizona Diamondbacks": "ari", "Atlanta Braves": "atl", "Baltimore Orioles": "bal", "Boston Red Sox": "bos",
  "Chicago Cubs": "chc", "Chicago White Sox": "cws", "Cincinnati Reds": "cin", "Cleveland Guardians": "cle",
  "Colorado Rockies": "col", "Detroit Tigers": "det", "Houston Astros": "hou", "Kansas City Royals": "kc",
  "Los Angeles Angels": "laa", "Los Angeles Dodgers": "lad", "Miami Marlins": "mia", "Milwaukee Brewers": "mil",
  "Minnesota Twins": "min", "New York Mets": "nym", "New York Yankees": "nyy", "Athletics": "ath",
  "Oakland Athletics": "ath", "Philadelphia Phillies": "phi", "Pittsburgh Pirates": "pit", "San Diego Padres": "sd",
  "San Francisco Giants": "sf", "Seattle Mariners": "sea", "St. Louis Cardinals": "stl", "Tampa Bay Rays": "tb",
  "Texas Rangers": "tex", "Toronto Blue Jays": "tor", "Washington Nationals": "wsh",
};
function teamLogoUrl(team: string) {
  const abbr = TEAM_ABBR[team];
  return abbr ? `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr}.png` : "";
}
function cleanPitcherName(summary: string) {
  let text = String(summary || "").trim();
  text = text.replace(/\([^)]*\)/g, "").replace(/\bLine\b.*$/i, "");
  text = text.replace(/\d+(\.\d+)?/g, "").replace(/\s+/g, " ").trim();
  return text;
}
function extractProjectedK(summary: string) {
  const noParens = String(summary || "").replace(/\([^)]*\)/g, "");
  const match = noParens.match(/\b(\d+(?:\.\d+)?)\b/);
  return match?.[1] || "—";
}
function extractLine(summary: string, fallback = "") {
  const text = `${summary || ""} ${fallback || ""}`;
  const match = text.match(/Line\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (match?.[1]) return match[1];
  const f = String(fallback || "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return f?.[1] || "—";
}
function initials(name: string) {
  const parts = String(name || "").replace(",", " ").split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "P";
}
function imageFromRow(row: SheetRow, keys: string[]) {
  for (const key of keys) {
    const val = String(row[key] || "").trim();
    if (val.startsWith("http")) return val;
  }
  return "";
}
function TeamRow({ awayTeam, homeTeam }: { awayTeam: string; homeTeam: string }) {
  const awayLogo = teamLogoUrl(awayTeam);
  const homeLogo = teamLogoUrl(homeTeam);
  return (
    <div className="teamRow">
      <div className="teamSide">
        {awayLogo ? <img className="teamLogo" src={awayLogo} alt={`${awayTeam} logo`} /> : null}
        <div className="teamName">{awayTeam}</div>
      </div>
      <div className="vsText">AT</div>
      <div className="teamSide home">
        <div className="teamName">{homeTeam}</div>
        {homeLogo ? <img className="teamLogo" src={homeLogo} alt={`${homeTeam} logo`} /> : null}
      </div>
    </div>
  );
}
function PitcherPhoto({ url, summary }: { url?: string; summary: string }) {
  const name = cleanPitcherName(summary);
  return url ? <img className="headshot" src={url} alt={`${name} headshot`} /> : <div className="headshotFallback">{initials(name)}</div>;
}
function MiniBubble({ label, value, green }: { label: string; value: string | number; green?: boolean }) {
  return (
    <div className={`miniBubble ${green ? "green" : ""}`}>
      <div className="miniLabel">{label}</div>
      <div className="miniValue">{value || "—"}</div>
    </div>
  );
}
function isKType(type: string) {
  return ["OVER", "UNDER", "LEAN OVER", "LEAN UNDER", "STRONG OVER", "STRONG UNDER"].includes(normalizeType(type));
}
function BestPlayCard({ play, index }: { play: Play; index: number }) {
  const pitcherName = cleanPitcherName(play.play);
  const kPlay = isKType(play.playType);
  return (
    <div className="card green">
      <div className="cardTop">
        <div className="rankBadge">#{index + 1}</div>
        <div className="scorePill">{play.playType} • Score {play.score || "—"}</div>
      </div>
      {play.awayTeam && play.homeTeam ? <TeamRow awayTeam={play.awayTeam} homeTeam={play.homeTeam} /> : <div className="cardSub">{play.game}</div>}
      {kPlay ? (
        <>
          <div className="playMain">
            <PitcherPhoto summary={play.play} url={play.headshotUrl} />
            <div>
              <div className="playName">{pitcherName}</div>
              <div className="playDetail">{play.game}</div>
            </div>
          </div>
          <div className="bubbleGrid">
            <MiniBubble label="Line" value={extractLine(play.play, play.oddsLine)} green />
            <MiniBubble label="Projected Ks" value={extractProjectedK(play.play)} green />
            <MiniBubble label="Rank Score" value={play.score || "—"} green />
            <MiniBubble label="Bet Type" value={play.playType} green />
          </div>
        </>
      ) : (
        <>
          <div className="cardTitle">{play.playType}</div>
          <div className="cardSub">{play.game}</div>
          <div className="bubbleGrid">
            <MiniBubble label="Bet Type" value={play.playType} green />
            <MiniBubble label="Selection" value={play.play} green />
            <MiniBubble label="Line/Odds" value={play.oddsLine || "—"} green />
            <MiniBubble label="Rank Score" value={play.score || "—"} green />
          </div>
        </>
      )}
    </div>
  );
}
function KBubbleGroup({ summary, score, isGreen }: { summary: string; score: string; isGreen: boolean }) {
  if (!summary) return null;
  return (
    <div className="bubbleGrid">
      <MiniBubble label="Line" value={extractLine(summary)} green={isGreen} />
      <MiniBubble label="Projected Ks" value={extractProjectedK(summary)} green={isGreen} />
      <MiniBubble label="Rank Score" value={score || "—"} green={isGreen} />
      <MiniBubble label="Bet Type" value={normalizeType(summary) || "—"} green={isGreen} />
    </div>
  );
}
function SlateCard({ row, greenSet }: { row: SheetRow; greenSet: Set<string> }) {
  const game = row["Game Label"] || `${row["Away Team"]} at ${row["Home Team"]}`;
  const awayK = row["Away Pitcher K + Grade"] || "";
  const homeK = row["Home Pitcher K + Grade"] || "";
  const awayType = normalizeType(awayK);
  const homeType = normalizeType(homeK);
  const awayGreen = greenSet.has(awayType);
  const homeGreen = greenSet.has(homeType);
  const mlType = normalizeType(row["ML Grade"] || "");
  const nrfiType = normalizeType(row["NRFI Grade"] || "");
  const mlGreen = greenSet.has(mlType);
  const nrfiGreen = greenSet.has(nrfiType);
  const hasGreen = awayGreen || homeGreen || mlGreen || nrfiGreen;
  return (
    <div className={`card ${hasGreen ? "green" : ""}`}>
      <div className="cardTitle">{game}</div>
      <TeamRow awayTeam={row["Away Team"] || ""} homeTeam={row["Home Team"] || ""} />
      <div className="marketStack">
        {row["ML Grade"] ? <div className={`marketBubble ${mlGreen ? "green" : ""}`}>Moneyline: {row["Better ML"] || "—"} • {row["ML Grade"]} • {row["ML Odds"] || "—"}</div> : null}
        {row["NRFI Grade"] ? <div className={`marketBubble ${nrfiGreen ? "green" : ""}`}>NRFI/YRFI: {row["NRFI Grade"]}</div> : null}
      </div>
      <div className="pitcherGrid">
        <div className="pitcherBox">
          <div className="pitcherHeader">
            <PitcherPhoto summary={awayK || "Away Pitcher"} url={imageFromRow(row, ["Away Pitcher Headshot URL", "Away Pitcher Headshot", "Away Pitcher Image URL"])} />
            <div>
              <div className="pitcherLabel">Away Pitcher</div>
              <div className="pitcherNameSmall">{cleanPitcherName(awayK) || "Away Pitcher"}</div>
            </div>
          </div>
          <KBubbleGroup summary={awayK} score={row["Away Pitcher K Score"] || ""} isGreen={awayGreen} />
        </div>
        <div className="pitcherBox">
          <div className="pitcherHeader">
            <PitcherPhoto summary={homeK || "Home Pitcher"} url={imageFromRow(row, ["Home Pitcher Headshot URL", "Home Pitcher Headshot", "Home Pitcher Image URL"])} />
            <div>
              <div className="pitcherLabel">Home Pitcher</div>
              <div className="pitcherNameSmall">{cleanPitcherName(homeK) || "Home Pitcher"}</div>
            </div>
          </div>
          <KBubbleGroup summary={homeK} score={row["Home Pitcher K Score"] || ""} isGreen={homeGreen} />
        </div>
      </div>
    </div>
  );
}
function RecordsTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap">
      <table>
        <thead><tr><th>Bet Type</th><th>Status</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.betType}>
              <td>{r.betType}</td>
              <td><span className={`chip ${statusClass(r.wins, r.losses)}`}>{r.status}</span></td>
              <td>{r.wins}-{r.losses}-{r.pushes}</td>
              <td>{r.winPct}%</td>
              <td>{r.unitsWon}u</td>
              <td>{r.roiPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<Tab>("Today’s Best Plays");

  useEffect(() => {
    fetch("/api/public-data", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => json.ok ? setData(json) : setError(json.error || "Could not load public data."))
      .catch((err) => setError(err.message || "Could not load public data."));
  }, []);

  const content = useMemo(() => {
    if (error) return <div className="error">{error}</div>;
    if (!data) return <div className="empty">Loading EZPZ Picks...</div>;
    const greenSet = new Set(data.last7RecordSummary.filter((r) => r.wins > r.losses).map((r) => r.betType));

    if (active === "Today’s Best Plays") return (
      <>
        <div className="sectionHead"><div><h2>Today’s Best Plays</h2><p>Today’s pending tracker bets whose bet type is winning over the last 7 days. Last updated: {data.lastUpdated}</p></div></div>
        {data.bestPlays.length ? <div className="cards">{data.bestPlays.map((p, i) => <BestPlayCard key={`${p.game}-${p.play}-${i}`} play={p} index={i} />)}</div> : <div className="empty">No 7-day green best plays saved yet for {data.today}.</div>}
      </>
    );

    if (active === "Full Slate") return (
      <>
        <div className="sectionHead"><div><h2>Full Slate</h2><p>Every saved game for {data.today}. Only green best-play bet types use green bubbles.</p></div></div>
        {data.slateToday.length ? <div className="cards">{data.slateToday.map((row, i) => <SlateCard key={`${row["Game ID"]}-${i}`} row={row} greenSet={greenSet} />)}</div> : <div className="empty">No games saved today yet.</div>}
      </>
    );

    return (
      <>
        <div className="sectionHead"><div><h2>Last 7 Days Records</h2><p>These recent bet-type records decide what appears in Today’s Best Plays.</p></div></div>
        {data.last7RecordSummary.length ? <RecordsTable rows={data.last7RecordSummary} /> : <div className="empty">No completed bets in the last 7 days.</div>}
        <div className="sectionHead"><div><h2>All-Time Records</h2><p>Long-term bet-type performance from your completed tracker.</p></div></div>
        {data.recordSummary.length ? <RecordsTable rows={data.recordSummary} /> : <div className="empty">No completed bets yet.</div>}
      </>
    );
  }, [active, data, error]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      <main className="shell">
        <section className="hero">
          <div className="logoWrap"><div className="logoFallback">EZ</div><img className="logo" src="/ezpz_logo.png" alt="EZPZ Picks logo" /></div>
          <h1>EZPZ Picks</h1>
          <p className="heroSub">Algorithm-driven MLB betting projections, ranked by your recent green bet-type performance.</p>
          <div className="versionPill">{BUILD_LABEL}</div>
        </section>
        {data ? (
          <section className="tileGrid">
            <Tile label="Last 7 Days Green Bets" value={data.tiles.last7Days.record} meta={`${data.tiles.last7Days.winPct}% • ${data.tiles.last7Days.unitsWon}u • ROI ${data.tiles.last7Days.roiPct}%`} green />
            <Tile label="Overall Green Bets" value={data.tiles.overallGreen.record} meta={`${data.tiles.overallGreen.winPct}% • ${data.tiles.overallGreen.unitsWon}u • ROI ${data.tiles.overallGreen.roiPct}%`} green />
            <Tile label="Today’s Best Plays" value={String(data.tiles.bestPlaysToday)} meta="Pending 7-day green plays" green={data.tiles.bestPlaysToday > 0} />
          </section>
        ) : null}
        <nav className="tabs">{TABS.map((tab) => <button key={tab} className={`tabBtn ${active === tab ? "active" : ""}`} onClick={() => setActive(tab)}>{tab}</button>)}</nav>
        {content}
      </main>
    </>
  );
}
