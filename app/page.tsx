"use client";

import { useEffect, useMemo, useState } from "react";
type RecordTotals = { label: string; record: string; totalBets: number; winPct: number; unitsWon: number; roiPct: number; wins: number; losses: number; pushes: number; };
type Summary = { betType: string; status: "WINNING" | "EVEN" | "LOSING"; wins: number; losses: number; pushes: number; totalBets: number; winPct: number; unitsWon: number; roiPct: number; };
type Play = { playType: string; game: string; play: string; oddsLine: string; score: string | number; isGreen: boolean; };
type SheetRow = Record<string, string>;
type ApiData = {
  ok: boolean;
  error?: string;
  today: string;
  lastUpdated: string;
  tiles: { last7Days: RecordTotals; overallGreen: RecordTotals; pendingGreen: number; bestPlaysToday: number; };
  bestPlays: Play[];
  slateToday: SheetRow[];
  recordSummary: Summary[];
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

.tileGrid { display:grid; grid-template-columns: repeat(4, 1fr); gap:14px; margin: 12px 0 20px; }
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

const tabs = ["Today’s Best Plays", "Slate", "Records", "About"] as const;
type Tab = typeof tabs[number];

function statusClass(wins: number, losses: number) {
  if (wins > losses) return "green";
  if (wins === losses) return "yellow";
  return "red";
}

function Tile({ label, value, meta, green = false }: { label: string; value: string | number; meta: string; green?: boolean }) {
  return <div className={`tile ${green ? "green" : ""}`}><div className="tileLabel">{label}</div><div className="tileValue">{value}</div><div className="tileMeta">{meta}</div></div>;
}

function RecordTile({ title, totals }: { title: string; totals: RecordTotals }) {
  return <Tile label={title} value={totals.record} meta={`${totals.winPct}% • ${totals.unitsWon}u / ${totals.roiPct}% ROI`} green={totals.wins >= totals.losses && totals.totalBets > 0} />;
}

function BestPlayCard({ play }: { play: Play }) {
  return (
    <div className="card green">
      <div className="cardTitle">{play.playType}</div>
      <div className="cardSub">{play.game}</div>
      <span className="chip green">GREEN PLAY</span>
      <div className="kv"><span>Play</span><span>{play.play}</span></div>
      <div className="kv"><span>Odds / Line</span><span>{play.oddsLine || "Manual"}</span></div>
      <div className="kv"><span>Score</span><span>{play.score || "—"}</span></div>
    </div>
  );
}

function SlateCard({ row }: { row: SheetRow }) {
  const game = row["Game Label"] || `${row["Away Team"]} at ${row["Home Team"]}`;
  const chips = [
    ["ML", row["ML Grade"] && row["ML Grade"] !== "PASS" ? `${row["Better ML"]} • ${row["ML Grade"]}` : ""],
    ["NRFI", row["NRFI Grade"] && row["NRFI Grade"] !== "PASS" ? row["NRFI Grade"] : ""],
    ["Away K", row["Away Pitcher K + Grade"] && !row["Away Pitcher K + Grade"].includes("PASS") ? row["Away Pitcher K + Grade"] : ""],
    ["Home K", row["Home Pitcher K + Grade"] && !row["Home Pitcher K + Grade"].includes("PASS") ? row["Home Pitcher K + Grade"] : ""],
  ].filter(([, value]) => value);

  return (
    <div className={`card ${chips.length ? "green" : ""}`}>
      <div className="cardTitle">{game}</div>
      <div className="cardSub">{row["Away Team"]} at {row["Home Team"]}</div>
      {chips.length ? chips.map(([label, value]) => <span key={label} className="chip green">{label}: {value}</span>) : <span className="chip yellow">No qualifying plays</span>}
    </div>
  );
}

function RecordsTable({ rows }: { rows: Summary[] }) {
  return <div className="tableWrap"><table><thead><tr><th>Bet Type</th><th>Status</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th></tr></thead><tbody>{rows.map((r) => <tr key={r.betType}><td>{r.betType}</td><td><span className={`chip ${statusClass(r.wins, r.losses)}`}>{r.status}</span></td><td>{r.wins}-{r.losses}-{r.pushes}</td><td>{r.winPct}%</td><td>{r.unitsWon}u</td><td>{r.roiPct}%</td></tr>)}</tbody></table></div>;
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

    if (active === "Today’s Best Plays") return <><div className="sectionHead"><div><h2>Today’s Best Plays</h2><p>Only green bets from today’s saved slate. Last updated: {data.lastUpdated}</p></div></div>{data.bestPlays.length ? <div className="cards">{data.bestPlays.map((p, i) => <BestPlayCard key={`${p.game}-${p.play}-${i}`} play={p} />)}</div> : <div className="empty">No green best plays saved yet for {data.today}.</div>}</>;

    if (active === "Slate") return <><div className="sectionHead"><div><h2>Today’s Slate</h2><p>Every saved game for {data.today}, with green plays highlighted.</p></div></div>{data.slateToday.length ? <div className="cards">{data.slateToday.map((row, i) => <SlateCard key={`${row["Game ID"]}-${i}`} row={row} />)}</div> : <div className="empty">No games saved today yet.</div>}</>;

    if (active === "Records") return <><div className="sectionHead"><div><h2>Records</h2><p>Bet-type performance from your completed tracker.</p></div></div>{data.recordSummary.length ? <RecordsTable rows={data.recordSummary} /> : <div className="empty">No completed bets yet.</div>}</>;

    return <><div className="sectionHead"><div><h2>About EZPZ Picks</h2><p>Algorithm-driven MLB betting insights built from your model outputs.</p></div></div><div className="card"><div className="cardTitle">Model-first betting dashboard</div><div className="cardSub">EZPZ Picks highlights model-qualified moneylines, NRFI/YRFI spots, and pitcher strikeout props. Public users see the clean read-only site while the Streamlit admin can keep writing into Google Sheets behind the scenes.</div><div className="kv"><span>Data source</span><span>Google Sheets</span></div><div className="kv"><span>Refresh logic</span><span>Eastern Time</span></div><div className="kv"><span>Public tab</span><span>Today’s Best Plays</span></div></div></>;
  }, [active, data, error]);

  return (
    <main className="shell">
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      <section className="hero">
        <div className="logoWrap"><div className="logoGlow" /><img className="logo" src="/ezpz_logo.png" alt="EZPZ Picks logo" onError={(e) => { e.currentTarget.style.display = "none"; }} /><div className="logoFallback">EZ</div></div>
        <h1>EZPZ Picks</h1>
        <p className="heroSub">Premium MLB model plays, daily slate insights, and record tracking powered by your betting algorithm.</p>
        <div className="brandPill"><span className="pulse" /> Powered by EZPZ Model</div>
      </section>

      {data && <section className="tileGrid"><RecordTile title="Last 7 Days" totals={data.tiles.last7Days} /><RecordTile title="Overall Green Bets" totals={data.tiles.overallGreen} /><Tile label="Best Plays Today" value={data.tiles.bestPlaysToday} meta="Green plays on today’s board" green /><Tile label="Pending Green Plays" value={data.tiles.pendingGreen} meta="Open tracker bets" /></section>}

      <nav className="tabs">{tabs.map((tab) => <button key={tab} className={`tabBtn ${active === tab ? "active" : ""}`} onClick={() => setActive(tab)}>{tab}</button>)}</nav>
      {content}
    </main>
  );
}
