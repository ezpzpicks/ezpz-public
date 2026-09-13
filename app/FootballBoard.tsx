"use client";

import FootballBoardBase from "./FootballBoardBase";
import { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";

type Tab = "Today’s Model Plays" | "Today’s Trend Plays" | "EZPZ Picks" | "Full Slate" | "Records";
type Sport = "NFL" | "NCAAF";
type FormStatus = "HOT" | "COLD" | "NEUTRAL" | "SAMPLE";
type SheetRow = Record<string, string>;
type RecordTotals = {
  label?: string;
  record: string;
  totalBets: number;
  winPct: number;
  unitsWon: number;
  roiPct: number;
  wins: number;
  losses: number;
  pushes: number;
};
type Summary = RecordTotals & { betType: string; status?: "WINNING" | "EVEN" | "LOSING" };

type NflPlay = {
  playType?: string;
  game?: string;
  play?: string;
  oddsLine?: string;
  marketOdds?: string;
  score?: string | number;
  reliability?: string | number;
  role?: string;
  playerName?: string;
  playerTeam?: string;
  propMarket?: string;
  propSide?: string;
  propLine?: string | number;
  propProjection?: string | number;
  headshotUrl?: string;
  formStatus?: FormStatus;
  formRecord?: string;
  formTotalBets?: number;
  formType?: string;
};

type NflEzpzPick = {
  source: "Best Play" | "Trend Play" | "Best + Trend";
  game: string;
  market: "Spread" | "Total" | "Player Prop";
  selection: string;
  odds?: string;
  score?: number;
  tier?: string;
  qualification?: string;
  record?: string;
  formStatus?: FormStatus;
  formType?: string;
  headshotUrl?: string;
  playerName?: string;
  playerTeam?: string;
  propMarket?: string;
  propSide?: string;
  propLine?: string | number;
  gapPct?: number;
  modelGapPct?: number;
  predictedWinPct?: number;
  impliedProbabilityPct?: number;
  trendModelVersion?: string;
  snapshotStatus?: string;
};

type FootballData = {
  today?: string;
  lastUpdated?: string;
  bestPlays?: NflPlay[];
  aiPicks?: NflEzpzPick[];
  aiSelectorStatus?: { message?: string };
  betTrackerRows?: SheetRow[];
  trendRecordRows?: SheetRow[];
  recordSummary?: Summary[];
  last7RecordSummary?: Summary[];
  database?: string;
  tiles?: {
    last7Days?: RecordTotals;
    overallGreen?: RecordTotals;
  };
};

function pct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const p = Math.abs(n) <= 1 ? n * 100 : n;
  return `${p.toFixed(1)}%`;
}
function displayOdds(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const signed = raw.replace(/−/g, "-").match(/[+-]\d{3,4}/)?.[0];
  return signed || raw;
}
function formBadge(status?: FormStatus, record?: string, totalBets?: number) {
  if (status === "HOT") return { icon: "🔥", label: "HOT", cls: "hot", detail: record || "—" };
  if (status === "COLD") return { icon: "❄️", label: "COLD", cls: "cold", detail: record || "—" };
  if (status === "NEUTRAL") return { icon: "➖", label: "NEUTRAL", cls: "neutral", detail: record || "—" };
  return {
    icon: "⚠️",
    label: "SMALL SAMPLE",
    cls: "sample",
    detail: `${record || "0-0-0"}${Number.isFinite(Number(totalBets)) ? ` • ${Number(totalBets)}/7` : ""}`,
  };
}

function PlayerHeadshot({ play, compact = false }: { play: NflPlay | NflEzpzPick; compact?: boolean }) {
  const name = String(play.playerName || "").trim();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "NFL";
  return (
    <div className={`nflHeadshot ${compact ? "compact" : ""}`}>
      <span>{initials}</span>
      {play.headshotUrl ? (
        <img src={play.headshotUrl} alt={`${name} headshot`} loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />
      ) : null}
    </div>
  );
}
function FormPill({ play }: { play: NflPlay }) {
  const form = formBadge(play.formStatus, play.formRecord, play.formTotalBets);
  return (
    <div className={`nflFormPill ${form.cls}`} title="EZPZ Model Play form uses the most recent 7 completed bets for this exact bet type.">
      <strong>{form.icon} {form.label}</strong>
      <span>{play.formType || "Bet type"} • {form.detail}</span>
    </div>
  );
}
function Metric({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return <div className={`nflMetric ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value || "—"}</strong></div>;
}
function NflModelCard({ play, index }: { play: NflPlay; index: number }) {
  const isProp = String(play.role || "").toLowerCase().includes("player prop");
  const form = formBadge(play.formStatus, play.formRecord, play.formTotalBets);
  return (
    <article className={`nflOptimizedCard ${isProp ? "prop" : "game"} ${play.formStatus === "HOT" ? "hotCard" : ""}`}>
      <div className="nflCardTop"><span className="nflRank">#{index + 1}</span><span className={`nflMiniForm ${form.cls}`}>{form.icon} {form.label}</span></div>
      {isProp ? (
        <div className="nflPlayerHero">
          <PlayerHeadshot play={play} />
          <div><span className="nflEyebrow"><TeamLogoName sport="NFL" team={play.playerTeam || ""} text={play.playerTeam || "NFL"} compact /> • {play.propMarket || "Player Prop"}</span><h3>{play.playerName || play.play}</h3><p><MatchupWithLogos sport="NFL" game={play.game || ""} compact /></p></div>
        </div>
      ) : (
        <div className="nflGameHero"><span className="nflEyebrow">{play.formType || play.role || "NFL Model Play"}</span><h3><SelectionWithTeamLogo sport="NFL" selection={play.play || ""} game={play.game || ""} /></h3><p><MatchupWithLogos sport="NFL" game={play.game || ""} compact /></p></div>
      )}
      {isProp ? <div className="nflPropPickLine"><span>{play.propSide || "Pick"}</span><strong>{play.propLine || "—"}</strong><small>{play.playType || "Prop"}</small></div> : <div className="nflGradeLine">{play.playType || "Model Play"}</div>}
      <div className="nflMetricGrid">
        <Metric label="Odds" value={displayOdds(play.marketOdds || play.oddsLine)} accent />
        <Metric label="Model Probability" value={pct(play.score)} accent />
        {isProp ? <Metric label="Projection" value={play.propProjection || "—"} /> : null}
        <Metric label="Reliability" value={play.reliability || "—"} />
      </div>
      <FormPill play={play} />
      <div className="nflRuleHint">{play.formStatus === "HOT" ? "Model Play form gate passed • EZPZ still requires price -150 or better" : "Model Play form gate not currently passed"}</div>
    </article>
  );
}
function NflModelPlays({ data }: { data: FootballData }) {
  const plays = data.bestPlays || [];
  return (
    <section className="nflOptimizedSection">
      <div className="nflOptimizedHead"><div><h2>NFL Today’s Model Plays</h2><p>Regression model plays with player headshots and exact Last-7 bet-type form badges.</p></div><span>{plays.length} plays</span></div>
      {plays.length ? <div className="nflOptimizedGrid">{plays.map((play, index) => <NflModelCard key={`${play.game}-${play.play}-${index}`} play={play} index={index} />)}</div> : <div className="nflOptimizedEmpty">No graded NFL Model Plays are saved for {data.today || "today"}.</div>}
    </section>
  );
}

function sourceLabel(source: NflEzpzPick["source"]) {
  if (source === "Best + Trend") return "MODEL + TREND";
  return source === "Best Play" ? "MODEL PLAY" : "TREND";
}
function NflEzpzCard({ pick }: { pick: NflEzpzPick }) {
  const hasModel = pick.source === "Best Play" || pick.source === "Best + Trend";
  const hasTrend = pick.source === "Trend Play" || pick.source === "Best + Trend";
  const isProp = pick.market === "Player Prop" || Boolean(pick.playerName);
  const final = hasModel || String(pick.snapshotStatus || "").toUpperCase() === "FINAL_PREGAME";
  const form = formBadge(pick.formStatus, pick.record);
  const gap = Number(pick.modelGapPct ?? pick.gapPct);
  return (
    <article className={`nflEzpzCard ${isProp ? "prop" : ""}`}>
      <div className="nflEzpzTop"><div className="nflEzpzBadges"><span className="nflSourceBadge">{sourceLabel(pick.source)}</span><span className={`nflStatusBadge ${final ? "final" : "pending"}`}>{final ? "FINAL" : "PENDING"}</span></div><strong className="nflEzpzOdds">{displayOdds(pick.odds)}</strong></div>
      {isProp ? (
        <div className="nflPlayerHero compactHero"><PlayerHeadshot play={pick} compact /><div><span className="nflEyebrow"><TeamLogoName sport="NFL" team={pick.playerTeam || ""} text={pick.playerTeam || "NFL"} compact /> • {pick.propMarket || "Player Prop"}</span><h3>{pick.playerName || pick.selection}</h3><p><MatchupWithLogos sport="NFL" game={pick.game || ""} compact /></p></div></div>
      ) : (
        <div className="nflEzpzSelection"><span><MatchupWithLogos sport="NFL" game={pick.game || ""} compact /></span><h3><SelectionWithTeamLogo sport="NFL" selection={pick.selection || ""} game={pick.game || ""} /></h3><p>{pick.market}</p></div>
      )}
      <div className="nflGateRow">
        {hasModel ? <div className={`nflGate best ${form.cls}`}><span>Model Play Gate</span><strong>{form.icon} HOT + -150 or better</strong><small>{pick.formType || "Bet type"} • {pick.record || "—"}</small></div> : null}
        {hasTrend ? <div className="nflGate trend"><span>Trend Gate</span><strong>{Number.isFinite(gap) ? `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}% GAP` : "15%+ GAP"}</strong><small>NFL V2 predicted win probability − market-implied probability must be +15.0% or higher</small></div> : null}
      </div>
      <div className="nflEzpzRuleText"><strong>{pick.qualification || "Qualified"}</strong>{hasTrend ? <span>Raw Handle − Bets is an input to the regression, not the 15% qualification gap. Net ROI is not a Trend gate.</span> : null}</div>
    </article>
  );
}
function NflEzpzPicks({ data }: { data: FootballData }) {
  const picks = data.aiPicks || [];
  return (
    <section className="nflOptimizedSection">
      <div className="nflOptimizedHead"><div><h2>NFL EZPZ Picks</h2><p>{data.aiSelectorStatus?.message || "Model Play = HOT + -150 or better. Trend = NFL V2 model gap ≥ +15%."}</p></div><span>{picks.length} picks</span></div>
      <div className="nflRulesStrip"><div><b>🔥 Model Play</b><span>HOT Last-7 badge + price -150 or better</span></div><div><b>📈 Trend</b><span>NFL V2 model gap ≥ +15%</span></div><div><b>ROI</b><span>Display/history only — never a qualification gate</span></div></div>
      {picks.length ? <div className="nflEzpzStack">{picks.map((pick, index) => <NflEzpzCard key={`${pick.game}-${pick.market}-${pick.selection}-${index}`} pick={pick} />)}</div> : <div className="nflOptimizedEmpty">No NFL EZPZ Picks qualify for {data.today || "today"} right now.</div>}
    </section>
  );
}

function fallbackTotals(): RecordTotals {
  return { record: "0-0-0", totalBets: 0, winPct: 0, unitsWon: 0, roiPct: 0, wins: 0, losses: 0, pushes: 0 };
}
function RecordTile({ label, value }: { label: string; value?: RecordTotals }) {
  const row = value || fallbackTotals();
  return <div className="card footballCanonicalRecordTile"><span>{label}</span><strong>{row.record}</strong><small>{row.winPct.toFixed(1)}% • {row.unitsWon > 0 ? "+" : ""}{row.unitsWon.toFixed(2)}u • ROI {row.roiPct > 0 ? "+" : ""}{row.roiPct.toFixed(1)}%</small></div>;
}
function RecordTable({ rows }: { rows: Summary[] }) {
  return (
    <div className="tableWrap"><table className="recordsTable"><thead><tr><th>Model subset</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th><th>Bets</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.betType}><td><strong>{row.betType}</strong></td><td>{row.record}</td><td>{row.winPct.toFixed(1)}%</td><td>{row.unitsWon > 0 ? "+" : ""}{row.unitsWon.toFixed(2)}u</td><td>{row.roiPct > 0 ? "+" : ""}{row.roiPct.toFixed(1)}%</td><td>{row.totalBets}</td></tr>)}
    </tbody></table></div>
  );
}
function RecordDropdown({ title, subtitle, rows, open = false }: { title: string; subtitle: string; rows: Summary[]; open?: boolean }) {
  return <details className="recordsDropdown" open={open || undefined}><summary className="recordsSummary"><div><div className="recordsSummaryTitle">{title}</div><div className="recordsSummarySub">{subtitle}</div></div><span className="recordsCount">{rows.reduce((sum, row) => sum + row.totalBets, 0)} bets</span></summary>{rows.length ? <RecordTable rows={rows} /> : <div className="empty insideDropdown">No completed results yet.</div>}</details>;
}
function resultCode(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (["W", "WIN", "WON"].includes(key)) return "W";
  if (["L", "LOSS", "LOST"].includes(key)) return "L";
  if (["P", "PUSH"].includes(key)) return "P";
  return "";
}
function recentLabel(row: SheetRow) {
  const market = String(row["Bet Type"] || row.Market || "Model Play").trim();
  const grade = String(row.Grade || row["Model Grade"] || "").trim();
  return [grade, market].filter(Boolean).join(" • ");
}
function recentSelection(row: SheetRow) {
  const direct = String(row.Selection || row.Pick || "").trim();
  if (direct) return direct;
  const player = String(row.Player || "").trim();
  const side = String(row.Side || "").trim();
  const line = String(row["Market Line"] || row.Line || row["Prop Line"] || "").trim();
  return [player, side, line].filter(Boolean).join(" ");
}
function recentGame(row: SheetRow) {
  const game = String(row.Game || "").trim();
  if (game) return game;
  const team = String(row.Team || "").trim();
  const opponent = String(row.Opponent || "").trim();
  return [team, opponent].filter(Boolean).join(" vs ") || "—";
}
function FootballRecords({ sport, data }: { sport: Sport; data: FootballData }) {
  const overall = data.tiles?.overallGreen || fallbackTotals();
  const last7 = data.tiles?.last7Days || fallbackTotals();
  const overallRows = data.recordSummary || [];
  const last7Rows = data.last7RecordSummary || [];
  const recent = (data.betTrackerRows || []).filter((row) => resultCode(row.Result || row.Status)).sort((a, b) => String(b.Date || b["Game Date"] || "").localeCompare(String(a.Date || a["Game Date"] || ""))).slice(0, 30);
  return (
    <section className="footballCanonicalRecords">
      <div className="sectionHead"><div><h2>{sport} Model Play Records</h2><p>{sport === "NFL" ? "Official graded NFL game and player-prop Model Plays from the canonical trackers." : "Official graded CFB Model Plays with A/B grade, market, and direction subsets."}</p></div></div>
      <div className="qualifiedGrid"><RecordTile label="Model Plays - Last 7 Days" value={last7} /><RecordTile label="Model Plays - Running Total" value={overall} /></div>
      <div className="sectionHead"><div><h2>Bet Type Records</h2><p>These are the exact subsets used for HOT / COLD / SMALL SAMPLE status.</p></div></div>
      <div className="advancedRecordsStack"><RecordDropdown title="Last 7 Days Model Plays" subtitle={`Exact ${sport} grade / market / direction records`} rows={last7Rows} open /><RecordDropdown title="Overall Model Plays" subtitle={`Running exact ${sport} grade / market / direction records`} rows={overallRows} /></div>
      <details className="recordsDropdown"><summary className="recordsSummary"><div><div className="recordsSummaryTitle">Recent Graded Model Plays</div><div className="recordsSummarySub">Individual graded plays behind the record</div></div><span className="recordsCount">{recent.length} results</span></summary>
        {recent.length ? <div className="tableWrap"><table className="recordsTable"><thead><tr><th>Date</th><th>Game</th><th>Type</th><th>Play</th><th>Result</th></tr></thead><tbody>{recent.map((row, index) => <tr key={`${row.Date}-${recentGame(row)}-${recentSelection(row)}-${index}`}><td>{row.Date || row["Game Date"]}</td><td>{recentGame(row)}</td><td>{recentLabel(row)}</td><td><strong>{recentSelection(row)}</strong></td><td>{resultCode(row.Result || row.Status)}</td></tr>)}</tbody></table></div> : <div className="empty insideDropdown">Completed Model Plays will populate here automatically.</div>}
      </details>
      <div className="card footballCanonicalInfo"><b>Record grading database:</b> {data.database || `${sport} Model Database`}<br />Model Plays are graded only after a completed game has a verified final result.</div>
    </section>
  );
}

export default function FootballBoard({ sport, tab, data }: { sport: Sport; tab: Tab; data: FootballData & Record<string, any> }) {
  if (tab === "Records") return <FootballRecords sport={sport} data={data} />;
  if (sport !== "NFL" || (tab !== "Today’s Model Plays" && tab !== "EZPZ Picks")) {
    return <FootballBoardBase sport={sport} tab={tab} data={data as any} />;
  }
  return (
    <>
      {tab === "Today’s Model Plays" ? <NflModelPlays data={data} /> : <NflEzpzPicks data={data} />}
      <style jsx global>{`
        .nflOptimizedSection{display:grid;gap:18px}.nflOptimizedHead{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.nflOptimizedHead h2{margin:0 0 5px;font-size:clamp(1.4rem,4vw,2.2rem);letter-spacing:-.04em}.nflOptimizedHead p{margin:0;max-width:800px;color:var(--ez-muted);font-size:.86rem;line-height:1.45}.nflOptimizedHead>span{flex:0 0 auto;border:1px solid var(--ez-border);border-radius:999px;padding:7px 11px;color:var(--ez-muted);font-size:.8rem;font-weight:850}.nflOptimizedGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.nflOptimizedCard,.nflEzpzCard{position:relative;overflow:hidden;border:1px solid rgba(80,132,197,.2);border-radius:24px;padding:18px;background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2));box-shadow:0 24px 65px rgba(0,0,0,.24)}.nflOptimizedCard.hotCard{border-color:rgba(43,216,117,.42);box-shadow:0 0 0 1px rgba(43,216,117,.1),0 0 25px rgba(43,216,117,.12),0 24px 65px rgba(0,0,0,.25)}.nflCardTop,.nflEzpzTop{display:flex;align-items:center;justify-content:space-between;gap:12px}.nflRank{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:rgba(47,140,255,.12);border:1px solid rgba(47,140,255,.2);font-size:.78rem;font-weight:950}.nflMiniForm,.nflStatusBadge,.nflSourceBadge{display:inline-flex;align-items:center;border-radius:999px;padding:6px 9px;border:1px solid rgba(112,145,186,.2);font-size:.68rem;font-weight:950;letter-spacing:.04em}.nflMiniForm.hot,.nflFormPill.hot,.nflGate.hot{color:#adf4c7;border-color:rgba(43,216,117,.34);background:rgba(28,130,78,.15)}.nflMiniForm.cold,.nflFormPill.cold,.nflGate.cold{color:#b7d7ff;border-color:rgba(94,167,255,.3);background:rgba(50,108,180,.14)}.nflMiniForm.neutral,.nflFormPill.neutral,.nflGate.neutral{color:#d4deeb;background:rgba(100,120,146,.12)}.nflMiniForm.sample,.nflFormPill.sample,.nflGate.sample{color:#f7d98d;border-color:rgba(247,200,92,.26);background:rgba(155,115,30,.13)}.nflPlayerHero{display:grid;grid-template-columns:92px minmax(0,1fr);align-items:center;gap:14px;margin-top:15px}.nflPlayerHero.compactHero{grid-template-columns:72px minmax(0,1fr)}.nflHeadshot{position:relative;display:grid;place-items:center;width:92px;height:92px;overflow:hidden;border:1px solid rgba(94,159,247,.24);border-radius:20px;background:radial-gradient(circle at 50% 30%,rgba(64,146,255,.22),rgba(8,18,34,.88));color:rgba(181,211,246,.7);font-weight:950}.nflHeadshot.compact{width:72px;height:72px;border-radius:17px}.nflHeadshot img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom}.nflEyebrow{display:block;color:#78b9ff;font-size:.7rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase}.nflPlayerHero h3,.nflGameHero h3,.nflEzpzSelection h3{margin:4px 0 3px;color:#f5f9ff;font-size:clamp(1.35rem,4vw,2rem);line-height:1.06;letter-spacing:-.035em}.nflPlayerHero p,.nflGameHero p,.nflEzpzSelection p{margin:0;color:var(--ez-muted);font-size:.8rem}.nflGameHero{margin-top:18px}.nflPropPickLine{display:grid;grid-template-columns:auto 1fr auto;align-items:baseline;gap:9px;margin-top:15px;border-radius:16px;padding:12px 14px;background:rgba(47,140,255,.075);border:1px solid rgba(47,140,255,.15)}.nflPropPickLine span{color:#9ccaff;font-size:.8rem;font-weight:950;text-transform:uppercase}.nflPropPickLine strong{font-size:1.7rem;letter-spacing:-.04em}.nflPropPickLine small,.nflGradeLine{color:var(--ez-muted);font-size:.75rem;font-weight:850}.nflGradeLine{margin-top:12px}.nflMetricGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:13px}.nflMetric{min-width:0;border:1px solid rgba(105,140,184,.14);border-radius:14px;padding:10px 11px;background:rgba(8,17,31,.6)}.nflMetric.accent{border-color:rgba(43,216,117,.16);background:rgba(11,38,35,.35)}.nflMetric span{display:block;color:var(--ez-muted);font-size:.62rem;font-weight:850;text-transform:uppercase;letter-spacing:.055em}.nflMetric strong{display:block;margin-top:4px;color:#f1f7ff;font-size:.95rem;overflow-wrap:anywhere}.nflFormPill{display:grid;gap:3px;margin-top:13px;border:1px solid rgba(112,145,186,.2);border-radius:14px;padding:10px 12px}.nflFormPill strong{font-size:.78rem}.nflFormPill span{font-size:.68rem;opacity:.78}.nflRuleHint{margin-top:9px;color:var(--ez-muted);font-size:.67rem;line-height:1.35}.nflOptimizedEmpty{border:1px solid var(--ez-border);border-radius:22px;padding:30px;text-align:center;color:var(--ez-muted);background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}.nflRulesStrip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.nflRulesStrip>div{display:grid;gap:3px;border:1px solid rgba(83,127,181,.17);border-radius:15px;padding:11px 12px;background:rgba(8,18,34,.55)}.nflRulesStrip b{font-size:.77rem}.nflRulesStrip span{color:var(--ez-muted);font-size:.67rem;line-height:1.3}.nflEzpzStack{display:grid;gap:12px}.nflEzpzCard{border-color:rgba(43,216,117,.35)}.nflEzpzBadges{display:flex;flex-wrap:wrap;gap:6px}.nflSourceBadge{color:#aef2c6;border-color:rgba(43,216,117,.28);background:rgba(28,130,78,.13)}.nflStatusBadge.final{color:#aef2c6}.nflStatusBadge.pending{color:#f4d482;border-color:rgba(247,200,92,.25)}.nflEzpzOdds{font-size:1.05rem}.nflEzpzSelection{margin-top:15px}.nflGateRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px;margin-top:14px}.nflGate{display:grid;gap:4px;border:1px solid rgba(83,127,181,.17);border-radius:15px;padding:11px 12px;background:rgba(8,18,34,.58)}.nflGate>span{color:var(--ez-muted);font-size:.62rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em}.nflGate strong{font-size:.95rem}.nflGate small{color:var(--ez-muted);font-size:.67rem}.nflGate.trend{border-color:rgba(47,140,255,.26);background:rgba(47,140,255,.075)}.nflGate.trend strong{color:#8bc5ff;font-size:1.22rem}.nflEzpzRuleText{display:grid;gap:4px;margin-top:11px;padding-top:10px;border-top:1px solid rgba(103,139,185,.12)}.nflEzpzRuleText strong{font-size:.72rem;color:#dcecff}.nflEzpzRuleText span{font-size:.66rem;color:var(--ez-muted);line-height:1.35}.footballCanonicalRecords{display:grid;gap:18px}.footballCanonicalRecordTile{display:grid;gap:5px}.footballCanonicalRecordTile>span{color:var(--ez-muted);font-size:.78rem;font-weight:850}.footballCanonicalRecordTile>strong{font-size:1.7rem}.footballCanonicalRecordTile>small{color:var(--ez-muted)}.footballCanonicalInfo{line-height:1.55}
        @media(max-width:850px){.nflOptimizedGrid{grid-template-columns:1fr}.nflRulesStrip{grid-template-columns:1fr}}
        @media(max-width:620px){.nflOptimizedHead{align-items:flex-start;flex-direction:column}.nflPlayerHero{grid-template-columns:78px minmax(0,1fr)}.nflHeadshot{width:78px;height:78px;border-radius:18px}.nflMetricGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.nflOptimizedCard,.nflEzpzCard{padding:15px;border-radius:21px}}
      `}</style>
    </>
  );
}
