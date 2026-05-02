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

const GLOBAL_CSS = `:root {
  --bg: #050b18;
  --bg2: #081426;
  --card: rgba(15, 23, 42, 0.88);
  --card2: rgba(17, 24, 39, 0.92);
  --border: rgba(59, 130, 246, 0.22);
  --border-strong: rgba(34, 197, 94, 0.65);
  --text: #f8fafc;
  --muted: #94a3b8;
  --soft: #cbd5e1;
  --green: #22c55e;
  --yellow: #f59e0b;
  --red: #ef4444;
  --blue: #38bdf8;
  --deep-blue: #2563eb;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(circle at top, rgba(59, 130, 246, 0.26), transparent 34rem),
    radial-gradient(circle at 80% 10%, rgba(34, 197, 94, 0.12), transparent 22rem),
    linear-gradient(180deg, var(--bg), var(--bg2));
  font-family: Arial, Helvetica, sans-serif;
}
button { font: inherit; }

.shell { width: min(1120px, calc(100% - 28px)); margin: 0 auto; padding: 28px 0 46px; }
.hero { text-align: center; padding: 16px 0 24px; position: relative; }
.logoWrap {
  width: 116px; height: 116px; margin: 0 auto 16px; border-radius: 999px;
  display: grid; place-items: center; position: relative;
  background: linear-gradient(145deg, rgba(56,189,248,.24), rgba(37,99,235,.1));
  box-shadow: 0 0 38px rgba(56,189,248,.36), inset 0 0 24px rgba(255,255,255,.06);
  border: 1px solid rgba(147,197,253,.35);
}
.logoGlow { position: absolute; inset: -16px; border-radius: 999px; background: radial-gradient(circle, rgba(56,189,248,.22), transparent 65%); filter: blur(8px); z-index: -1; }
.logo { width: 82px; height: 82px; object-fit: contain; border-radius: 999px; }
.logoFallback { position:absolute; font-size: 30px; font-weight: 950; letter-spacing: -2px; color: #dbeafe; z-index:0; }
.logo { position:relative; z-index:1; background: rgba(5,11,24,.7); }
h1 { margin: 0; font-size: clamp(2.05rem, 6vw, 4.1rem); letter-spacing: -0.075em; line-height: .95; }
.heroSub { margin: 12px auto 0; max-width: 660px; color: var(--soft); font-weight: 650; line-height: 1.55; }
.brandPill { display:inline-flex; gap:8px; align-items:center; margin-top:14px; padding:8px 13px; border-radius:999px; border:1px solid rgba(56,189,248,.28); background:rgba(15,23,42,.62); color:#dbeafe; font-weight:800; font-size:.82rem; }
.pulse { width:8px; height:8px; border-radius:999px; background:var(--green); box-shadow:0 0 16px var(--green); }

.tileGrid { display:grid; grid-template-columns: repeat(3, 1fr); gap:14px; margin: 12px 0 20px; }
.tile { background: linear-gradient(145deg, rgba(15,23,42,.94), rgba(17,24,39,.75)); border: 1px solid var(--border); border-radius: 22px; padding: 18px; box-shadow: 0 20px 50px rgba(0,0,0,.22); }
.tile.green { border-color: rgba(34,197,94,.42); box-shadow: 0 18px 54px rgba(34,197,94,.1); }
.tileLabel { color: var(--muted); font-size: .75rem; font-weight: 900; letter-spacing:.08em; text-transform: uppercase; }
.tileValue { font-size: 1.75rem; font-weight: 950; margin-top: 8px; letter-spacing: -.04em; }
.tileMeta { color: var(--soft); font-size: .84rem; margin-top: 6px; font-weight: 700; }

.tabs { position: sticky; top: 0; z-index: 3; display:flex; gap:10px; justify-content:center; padding:12px 0; backdrop-filter: blur(14px); }
.tabBtn { cursor:pointer; border:1px solid rgba(148,163,184,.2); background:rgba(15,23,42,.72); color:#dbeafe; border-radius:999px; padding:11px 15px; font-weight:900; transition: transform .16s ease, background .16s ease, border-color .16s ease; }
.tabBtn:hover { transform: translateY(-1px); border-color:rgba(56,189,248,.45); }
.tabBtn.active { background:linear-gradient(135deg, rgba(37,99,235,.95), rgba(14,165,233,.82)); border-color:rgba(125,211,252,.6); box-shadow:0 12px 30px rgba(37,99,235,.25); }

.sectionHead { margin: 22px 0 14px; display:flex; justify-content:space-between; gap:16px; align-items:flex-end; }
.sectionHead h2 { margin:0; font-size: clamp(1.35rem, 4vw, 2.25rem); letter-spacing:-.04em; }
.sectionHead p { margin:6px 0 0; color: var(--muted); font-weight:700; }

.cards { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:14px; }
.card { position: relative; overflow:hidden; background: linear-gradient(135deg, var(--card), var(--card2)); border:1px solid rgba(148,163,184,.16); border-radius:24px; padding:18px; box-shadow:0 24px 70px rgba(0,0,0,.24); }
.card.green { border-left: 6px solid var(--green); }
.card.yellow { border-left: 6px solid var(--yellow); }
.card.red { border-left: 6px solid var(--red); }
.card:before { content:""; position:absolute; inset:0 0 auto; height:1px; background:linear-gradient(90deg, transparent, rgba(125,211,252,.38), transparent); }
.cardTitle { font-size:1.04rem; font-weight:950; letter-spacing:-.02em; text-transform:uppercase; }
.cardSub { margin-top:5px; color:var(--soft); font-size:.86rem; font-weight:700; }
.chip { display:inline-flex; width:max-content; margin-top:12px; padding:6px 10px; border-radius:999px; font-size:.74rem; font-weight:950; text-transform:uppercase; }
.chip.green { background:#dcfce7; color:#166534; }
.chip.yellow { background:#fef3c7; color:#92400e; }
.chip.red { background:#fee2e2; color:#991b1b; }
.chip.soft { background:rgba(148,163,184,.12); color:#cbd5e1; border:1px solid rgba(148,163,184,.18); }
.bubbleGrid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:8px; margin-top:14px; }
.miniBubble { border:1px solid rgba(148,163,184,.18); border-radius:15px; padding:9px 8px; background:rgba(15,23,42,.46); min-width:0; }
.miniBubble.green { background:rgba(34,197,94,.16); border-color:rgba(34,197,94,.48); }
.miniLabel { color:var(--muted); font-size:.63rem; line-height:1; font-weight:950; letter-spacing:.07em; text-transform:uppercase; }
.miniValue { color:#f8fafc; font-size:.83rem; font-weight:950; margin-top:5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pitcherGrid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px; }
.pitcherBox { border:1px solid rgba(148,163,184,.16); border-radius:18px; padding:12px; background:rgba(15,23,42,.34); }
.pitcherLabel { color:#93c5fd; font-size:.72rem; font-weight:950; letter-spacing:.08em; text-transform:uppercase; margin-bottom:8px; }
@media (max-width: 620px) { .bubbleGrid { grid-template-columns: repeat(2, minmax(0,1fr)); } .pitcherGrid { grid-template-columns:1fr; } }
.cardMedia { display:flex; align-items:center; gap:12px; margin:12px 0 8px; }
.teamLogo { width:38px; height:38px; border-radius:999px; object-fit:contain; background:rgba(255,255,255,.92); padding:4px; border:1px solid rgba(148,163,184,.18); }
.teamPair { display:flex; align-items:center; gap:8px; }
.vsText { color:var(--muted); font-weight:950; font-size:.72rem; letter-spacing:.08em; }
.headshot { width:52px; height:52px; border-radius:999px; object-fit:cover; background:rgba(15,23,42,.9); border:2px solid rgba(34,197,94,.55); box-shadow:0 8px 22px rgba(0,0,0,.22); }
.headshotFallback { width:52px; height:52px; border-radius:999px; display:grid; place-items:center; background:linear-gradient(135deg, rgba(37,99,235,.42), rgba(15,23,42,.92)); border:1px solid rgba(56,189,248,.34); color:#e0f2fe; font-weight:950; font-size:.82rem; }
.playMain { display:flex; align-items:center; gap:12px; margin-top:12px; }
.playMainText { min-width:0; }
.playName { font-weight:950; color:#f8fafc; overflow:hidden; text-overflow:ellipsis; }
.playDetail { color:var(--muted); font-size:.82rem; font-weight:800; margin-top:2px; }
.kv { display:flex; justify-content:space-between; gap:14px; border-top:1px solid rgba(148,163,184,.15); padding-top:10px; margin-top:10px; }
.kv span:first-child { color:var(--muted); font-size:.8rem; font-weight:800; }
.kv span:last-child { color:var(--text); font-size:.88rem; font-weight:950; text-align:right; }
.empty { border:1px dashed rgba(148,163,184,.28); border-radius:22px; padding:28px; text-align:center; color:var(--soft); background:rgba(15,23,42,.42); }
.tableWrap { overflow:auto; border-radius:22px; border:1px solid rgba(148,163,184,.16); background:rgba(15,23,42,.7); }
table { width:100%; border-collapse: collapse; min-width: 720px; }
th, td { text-align:left; padding:13px 14px; border-bottom:1px solid rgba(148,163,184,.13); }
th { color:#bfdbfe; font-size:.75rem; text-transform:uppercase; letter-spacing:.08em; }
td { color:#e2e8f0; font-weight:700; }
.error { background:#450a0a; color:#fecaca; border:1px solid #ef4444; border-radius:18px; padding:16px; }
@media (max-width: 850px) { .tileGrid { grid-template-columns: repeat(2, 1fr); } .cards { grid-template-columns:1fr; } .tabs { overflow-x:auto; justify-content:flex-start; } .tabBtn { white-space:nowrap; } }
@media (max-width: 520px) { .shell { width:min(100% - 18px,1120px); padding-top:18px; } .tileGrid { grid-template-columns:1fr; } .tileValue { font-size:1.5rem; } .logoWrap{width:96px;height:96px}.logo{width:68px;height:68px} }
`;

const tabs = ["Today’s Best Plays", "Full Slate", "Records"] as const;
type Tab = (typeof tabs)[number];

function statusClass(wins: number, losses: number) {
  if (wins > losses) return "green";
  if (wins === losses) return "yellow";
  return "red";
}

function Tile({
  label,
  value,
  meta,
  green = false,
}: {
  label: string;
  value: string | number;
  meta: string;
  green?: boolean;
}) {
  return (
    <div className={`tile ${green ? "green" : ""}`}>
      <div className="tileLabel">{label}</div>
      <div className="tileValue">{value}</div>
      <div className="tileMeta">{meta}</div>
    </div>
  );
}

function RecordTile({
  title,
  totals,
}: {
  title: string;
  totals: RecordTotals;
}) {
  return (
    <Tile
      label={title}
      value={totals.record}
      meta={`${totals.winPct}% • ${totals.unitsWon}u / ${totals.roiPct}% ROI`}
      green={totals.wins >= totals.losses && totals.totalBets > 0}
    />
  );
}

const TEAM_IDS: Record<string, number> = {
  "Arizona Diamondbacks": 109,
  "Atlanta Braves": 144,
  "Baltimore Orioles": 110,
  "Boston Red Sox": 111,
  "Chicago Cubs": 112,
  "Chicago White Sox": 145,
  "Cincinnati Reds": 113,
  "Cleveland Guardians": 114,
  "Colorado Rockies": 115,
  "Detroit Tigers": 116,
  "Houston Astros": 117,
  "Kansas City Royals": 118,
  "Los Angeles Angels": 108,
  "LA Angels": 108,
  "Los Angeles Dodgers": 119,
  "Miami Marlins": 146,
  "Milwaukee Brewers": 158,
  "Minnesota Twins": 142,
  "New York Mets": 121,
  "New York Yankees": 147,
  Athletics: 133,
  "Oakland Athletics": 133,
  "Philadelphia Phillies": 143,
  "Pittsburgh Pirates": 134,
  "San Diego Padres": 135,
  "San Francisco Giants": 137,
  "Seattle Mariners": 136,
  "St. Louis Cardinals": 138,
  "Tampa Bay Rays": 139,
  "Texas Rangers": 140,
  "Toronto Blue Jays": 141,
  "Washington Nationals": 120,
};

function teamLogoUrl(team: string) {
  const id = TEAM_IDS[team];
  return id ? `https://www.mlbstatic.com/team-logos/${id}.svg` : "";
}

function normalizeType(value: string) {
  const text = String(value || "")
    .trim()
    .toUpperCase();
  if (!text || text === "PASS") return "";
  if (text.includes("NON-EDGE MONEYLINE")) return "NON-EDGE MONEYLINE";
  if (text.includes("A MONEYLINE")) return "A MONEYLINE";
  if (text.includes("B MONEYLINE")) return "B MONEYLINE";
  if (text.includes("ELITE NRFI")) return "ELITE NRFI";
  if (text.includes("STRONG NRFI")) return "STRONG NRFI";
  if (text.includes("LEAN NRFI")) return "LEAN NRFI";
  if (text === "NRFI" || text.includes(" NRFI") || text.includes("(NRFI)"))
    return "NRFI";
  if (text.includes("YRFI")) return "YRFI";
  if (text.includes("STRONG OVER")) return "STRONG OVER";
  if (text.includes("LEAN OVER")) return "LEAN OVER";
  if (
    text === "OVER" ||
    text.endsWith(" OVER") ||
    text.includes("(OVER)") ||
    /\bOVER\b/.test(text)
  )
    return "OVER";
  if (text.includes("STRONG UNDER")) return "STRONG UNDER";
  if (text.includes("LEAN UNDER")) return "LEAN UNDER";
  if (
    text === "UNDER" ||
    text.endsWith(" UNDER") ||
    text.includes("(UNDER)") ||
    /\bUNDER\b/.test(text)
  )
    return "UNDER";
  return text;
}

function cleanPitcherName(summary: string) {
  let text = String(summary || "").trim();
  text = text
    .replace(/\([^)]*\)/g, "")
    .replace(/\bLine\b.*$/i, "")
    .trim();
  text = text
    .replace(/\d+(\.\d+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function extractProjectedK(summary: string) {
  const beforeLine = String(summary || "").replace(/\bLine\b.*$/i, "");
  const noGrade = beforeLine.replace(/\([^)]*\)/g, "");
  const matches = noGrade.match(/\d+(?:\.\d+)?/g);
  return matches?.[matches.length - 1] || "—";
}

function extractLine(summary: string, fallback = "") {
  const text = String(summary || "");
  const match = text.match(/Line\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (match) return match[1];
  const fb = String(fallback || "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return fb?.[1] || "—";
}

function MiniBubble({
  label,
  value,
  green = false,
}: {
  label: string;
  value: string | number;
  green?: boolean;
}) {
  return (
    <div className={`miniBubble ${green ? "green" : ""}`}>
      <div className="miniLabel">{label}</div>
      <div className="miniValue">{value || "—"}</div>
    </div>
  );
}

function initials(name: string) {
  const cleaned = cleanPitcherName(name).replace(",", " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "P") + (parts[parts.length - 1]?.[0] || "");
}

function imageFromRow(row: SheetRow, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] || "").trim();
    if (value.startsWith("http")) return value;
  }
  return "";
}

function TeamLogos({ row }: { row: SheetRow }) {
  const awayLogo =
    imageFromRow(row, ["Away Team Logo", "Away Logo", "Away Logo URL"]) ||
    teamLogoUrl(row["Away Team"] || "");
  const homeLogo =
    imageFromRow(row, ["Home Team Logo", "Home Logo", "Home Logo URL"]) ||
    teamLogoUrl(row["Home Team"] || "");
  return (
    <div className="teamPair">
      {awayLogo && (
        <img
          className="teamLogo"
          src={awayLogo}
          alt={`${row["Away Team"]} logo`}
        />
      )}
      <span className="vsText">AT</span>
      {homeLogo && (
        <img
          className="teamLogo"
          src={homeLogo}
          alt={`${row["Home Team"]} logo`}
        />
      )}
    </div>
  );
}

function PitcherPhoto({
  row,
  side,
  summary,
  url: directUrl,
}: {
  row?: SheetRow;
  side?: "Away" | "Home";
  summary: string;
  url?: string;
}) {
  const url =
    directUrl ||
    (row && side
      ? imageFromRow(row, [
          `${side} Pitcher Headshot`,
          `${side} Pitcher Headshot URL`,
          `${side} Pitcher Image`,
          `${side} Pitcher Image URL`,
        ])
      : "");
  const name = cleanPitcherName(summary);
  return url ? (
    <img className="headshot" src={url} alt={`${name} headshot`} />
  ) : (
    <div className="headshotFallback">{initials(name)}</div>
  );
}

function BestPlayTeamLogos({ play }: { play: Play }) {
  const awayLogo = teamLogoUrl(play.awayTeam || "");
  const homeLogo = teamLogoUrl(play.homeTeam || "");
  return (
    <div className="teamPair">
      {awayLogo && (
        <img
          className="teamLogo"
          src={awayLogo}
          alt={`${play.awayTeam} logo`}
        />
      )}
      <span className="vsText">AT</span>
      {homeLogo && (
        <img
          className="teamLogo"
          src={homeLogo}
          alt={`${play.homeTeam} logo`}
        />
      )}
    </div>
  );
}

function BestPlayCard({ play }: { play: Play }) {
  const pitcherName = cleanPitcherName(play.play);
  const isKPlay = [
    "OVER",
    "UNDER",
    "LEAN OVER",
    "LEAN UNDER",
    "STRONG OVER",
    "STRONG UNDER",
  ].includes(normalizeType(play.playType));
  return (
    <div className="card green">
      <div className="cardTitle">{play.playType}</div>
      <div className="cardSub">{play.game}</div>
      <div className="cardMedia">
        <BestPlayTeamLogos play={play} />
      </div>
      <div className="playMain">
        <PitcherPhoto summary={play.play} url={play.headshotUrl} />
        <div className="playMainText">
          <div className="playName">{isKPlay ? pitcherName : play.play}</div>
          <div className="playDetail">GREEN BEST PLAY</div>
        </div>
      </div>
      {isKPlay ? (
        <div className="bubbleGrid">
          <MiniBubble
            label="Line"
            value={extractLine(play.play, play.oddsLine)}
            green
          />
          <MiniBubble
            label="Proj K"
            value={extractProjectedK(play.play)}
            green
          />
          <MiniBubble label="Rank" value={play.score || "—"} green />
          <MiniBubble label="Bet Type" value={play.playType} green />
        </div>
      ) : (
        <div className="bubbleGrid">
          <MiniBubble label="Bet Type" value={play.playType} green />
          <MiniBubble label="Selection" value={play.play} green />
          <MiniBubble label="Line/Odds" value={play.oddsLine || "—"} green />
          <MiniBubble label="Rank" value={play.score || "—"} green />
        </div>
      )}
    </div>
  );
}

function KBubbleGroup({
  label,
  summary,
  score,
  isGreen,
}: {
  label: string;
  summary: string;
  score: string;
  isGreen: boolean;
}) {
  if (!summary || summary.includes("PASS")) return null;
  const betType = normalizeType(summary);
  return (
    <div className="bubbleGrid">
      <MiniBubble
        label={`${label} Line`}
        value={extractLine(summary)}
        green={isGreen}
      />
      <MiniBubble
        label="Proj K"
        value={extractProjectedK(summary)}
        green={isGreen}
      />
      <MiniBubble label="Rank" value={score || "—"} green={isGreen} />
      <MiniBubble label="Bet Type" value={betType || "—"} green={isGreen} />
    </div>
  );
}

function SlateCard({
  row,
  greenSet,
}: {
  row: SheetRow;
  greenSet: Set<string>;
}) {
  const game =
    row["Game Label"] || `${row["Away Team"]} at ${row["Home Team"]}`;
  const awayK = row["Away Pitcher K + Grade"] || "";
  const homeK = row["Home Pitcher K + Grade"] || "";
  const chips = [
    {
      label: "ML",
      value:
        row["ML Grade"] && row["ML Grade"] !== "PASS"
          ? `${row["Better ML"]} • ${row["ML Grade"]}`
          : "",
      type: row["ML Grade"],
    },
    {
      label: "NRFI",
      value:
        row["NRFI Grade"] && row["NRFI Grade"] !== "PASS"
          ? row["NRFI Grade"]
          : "",
      type: row["NRFI Grade"],
    },
  ]
    .filter((chip) => chip.value)
    .map((chip) => ({
      ...chip,
      green: greenSet.has(normalizeType(chip.type || "")),
    }));
  const awayGreen = greenSet.has(normalizeType(awayK));
  const homeGreen = greenSet.has(normalizeType(homeK));
  const hasGreen = chips.some((chip) => chip.green) || awayGreen || homeGreen;

  return (
    <div className={`card ${hasGreen ? "green" : ""}`}>
      <div className="cardTitle">{game}</div>
      <div className="cardMedia">
        <TeamLogos row={row} />
      </div>
      <div className="pitcherGrid">
        <div className="pitcherBox">
          <div className="pitcherLabel">Away Pitcher</div>
          <div className="playMain">
            <PitcherPhoto
              row={row}
              side="Away"
              summary={awayK || "Away Pitcher"}
            />
            <div className="playMainText">
              <div className="playName">
                {cleanPitcherName(awayK) || "Away Pitcher"}
              </div>
            </div>
          </div>
          <KBubbleGroup
            label="Away K"
            summary={awayK}
            score={row["Away Pitcher K Score"] || ""}
            isGreen={awayGreen}
          />
        </div>
        <div className="pitcherBox">
          <div className="pitcherLabel">Home Pitcher</div>
          <div className="playMain">
            <PitcherPhoto
              row={row}
              side="Home"
              summary={homeK || "Home Pitcher"}
            />
            <div className="playMainText">
              <div className="playName">
                {cleanPitcherName(homeK) || "Home Pitcher"}
              </div>
            </div>
          </div>
          <KBubbleGroup
            label="Home K"
            summary={homeK}
            score={row["Home Pitcher K Score"] || ""}
            isGreen={homeGreen}
          />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        {chips.length ? (
          chips.map((chip) => (
            <span
              key={chip.label}
              className={`chip ${chip.green ? "green" : "soft"}`}
            >
              {chip.label}: {chip.value}
            </span>
          ))
        ) : (
          <span className="chip soft">No ML/NRFI play</span>
        )}
      </div>
    </div>
  );
}

function RecordsTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Bet Type</th>
            <th>Status</th>
            <th>Record</th>
            <th>Win %</th>
            <th>Units</th>
            <th>ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.betType}>
              <td>{r.betType}</td>
              <td>
                <span className={`chip ${statusClass(r.wins, r.losses)}`}>
                  {r.status}
                </span>
              </td>
              <td>
                {r.wins}-{r.losses}-{r.pushes}
              </td>
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
      .then((json) =>
        json.ok
          ? setData(json)
          : setError(json.error || "Could not load public data."),
      )
      .catch((err) => setError(err.message || "Could not load public data."));
  }, []);

  const content = useMemo(() => {
    if (error) return <div className="error">{error}</div>;
    if (!data) return <div className="empty">Loading EZPZ Picks...</div>;
    const greenSet = new Set(
      data.last7RecordSummary
        .filter((r) => r.wins > r.losses)
        .map((r) => r.betType),
    );

    if (active === "Today’s Best Plays")
      return (
        <>
          <div className="sectionHead">
            <div>
              <h2>Today’s Best Plays</h2>
              <p>
                Best Plays are based on bet types winning over the last 7 days.
                Last updated: {data.lastUpdated}
              </p>
            </div>
          </div>
          {data.bestPlays.length ? (
            <div className="cards">
              {data.bestPlays.map((p, i) => (
                <BestPlayCard key={`${p.game}-${p.play}-${i}`} play={p} />
              ))}
            </div>
          ) : (
            <div className="empty">
              No 7-day green best plays saved yet for {data.today}.
            </div>
          )}
        </>
      );

    if (active === "Full Slate")
      return (
        <>
          <div className="sectionHead">
            <div>
              <h2>Full Slate</h2>
              <p>
                Every saved game for {data.today}. Only green best plays use
                green bubbles.
              </p>
            </div>
          </div>
          {data.slateToday.length ? (
            <div className="cards">
              {data.slateToday.map((row, i) => (
                <SlateCard
                  key={`${row["Game ID"]}-${i}`}
                  row={row}
                  greenSet={greenSet}
                />
              ))}
            </div>
          ) : (
            <div className="empty">No games saved today yet.</div>
          )}
        </>
      );

    if (active === "Records")
      return (
        <>
          <div className="sectionHead">
            <div>
              <h2>Last 7 Days Records</h2>
              <p>
                These recent bet-type records decide what appears in Today’s
                Best Plays.
              </p>
            </div>
          </div>
          {data.last7RecordSummary.length ? (
            <RecordsTable rows={data.last7RecordSummary} />
          ) : (
            <div className="empty">No completed bets in the last 7 days.</div>
          )}
          <div className="sectionHead">
            <div>
              <h2>All-Time Records</h2>
              <p>Long-term bet-type performance from your completed tracker.</p>
            </div>
          </div>
          {data.recordSummary.length ? (
            <RecordsTable rows={data.recordSummary} />
          ) : (
            <div className="empty">No completed bets yet.</div>
          )}
        </>
      );

    return null;
  }, [active, data, error]);

  return (
    <main className="shell">
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      <section className="hero">
        <div className="logoWrap">
          <div className="logoGlow" />
          <img
            className="logo"
            src="/ezpz_logo.png"
            alt="EZPZ Picks logo"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <div className="logoFallback">EZ</div>
        </div>
        <h1>EZPZ Picks</h1>
        <p className="heroSub">
          Premium MLB model plays, daily slate insights, and record tracking
          powered by your betting algorithm.
        </p>
        <div className="brandPill">
          <span className="pulse" /> Powered by EZPZ Model
        </div>
      </section>

      {data && (
        <section className="tileGrid">
          <RecordTile
            title="Last 7 Days Green Bets"
            totals={data.tiles.last7Days}
          />
          <RecordTile
            title="Overall Green Bets"
            totals={data.tiles.overallGreen}
          />
          <Tile
            label="Best Plays Today"
            value={data.tiles.bestPlaysToday}
            meta="Green plays on today’s board"
            green
          />
        </section>
      )}

      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`tabBtn ${active === tab ? "active" : ""}`}
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      {content}
    </main>
  );
}
