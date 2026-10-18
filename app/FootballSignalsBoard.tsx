"use client";

import { useMemo, useRef, useState } from "react";
import { Banknote, TrendingUp, FlaskConical, Users, Calculator, Mountain, Search, X, ChevronUp, Clock3 } from "lucide-react";
import { TeamLogoName } from "./TeamLogoName";
import type { FootballSignalKey, FootballSignalSide, FootballSignalsBoard, FootballSignal } from "../lib/footballSignals";

const META = {
  money: { label: "Money", title: "Money support", Icon: Banknote },
  move: { label: "Line", title: "Line movement", Icon: TrendingUp },
  system: { label: "Public", title: "Public bet trends", Icon: FlaskConical },
  team: { label: "Team", title: "Team trends", Icon: Users },
  model: { label: "Model", title: "Model edge", Icon: Calculator },
  sos: { label: "SOS", title: "Strength of schedule", Icon: Mountain },
};
const format = (n: number | null | undefined, signed = false) => n == null ? "Unavailable" : `${signed && n > 0 ? "+" : ""}${Number(n.toFixed(1))}`;
const percent = (n: number | null | undefined) => n == null ? "Unavailable" : `${format(n)}%`;
function time(value: string, date = false) {
  const n = Date.parse(value); return Number.isFinite(n) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York",
    ...(date ? { month: "short", day: "numeric" } as const : {}), hour: "numeric", minute: "2-digit" }).format(n) + " ET" : "Time unavailable";
}
function Lines({ items }: { items: [string, string | number][] }) {
  return <dl className="fs-lines">{items.map(([label, value], i) => <div key={`${label}-${i}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="fs-detail-section"><h4>{title}</h4>{children}</section>;
}
function History({ side }: { side: FootballSignalSide }) {
  return <Section title="Market observations"><table className="fs-table"><thead><tr><th>Snapshot</th><th>Line / odds</th><th>Bets / money</th></tr></thead><tbody>
    {side.marketContext.history.length ? side.marketContext.history.map((point, i) => <tr key={`${point.snapshotTime}-${i}`}>
      <th scope="row">{time(String(point.snapshotTime || ""), true)}</th><td>{format(Number.isFinite(Number(point.line)) && point.line != null ? Number(point.line) : null, side.market === "Spread")}<small>{point.odds || "Odds unavailable"}</small></td>
      <td>{percent(point.betsPct == null ? null : Number(point.betsPct))}<small>{percent(point.moneyPct == null ? null : Number(point.moneyPct))}</small></td>
    </tr>) : <tr><td colSpan={3}>Observation history is unavailable.</td></tr>}
  </tbody></table></Section>;
}
function TeamDetail({ side }: { side: FootballSignalSide }) {
  const score = side.teamTrend;
  if (!score) return <p>Team records are awaiting a complete matchup and market line.</p>;
  return <>
    <Lines items={[["Overall grade", `${format(score.score)} out of 100`], ["Qualification", "75 or higher"], ["Method", score.method], ["Scope", score.scope]]} />
    {score.teams.map(team => <Section key={team.team} title={`${team.team} · ${team.venue}${team.role ? ` · ${team.role}` : ""}`}>
      <table className="fs-table"><thead><tr><th>Trend</th><th>Record / sample</th><th>Supporting rate</th></tr></thead><tbody>
        {Object.entries(team.records).map(([key, record]) => <tr key={key}><th scope="row">{record.label}<small>{record.weight}% weight</small></th>
          <td>{record.sample ? record.record : "No matching games"}<small>{record.sample} games</small></td>
          <td>{percent(record.supportPct)}<small>{format(record.supportPct * record.weight / 100)} toward grade</small></td></tr>)}
      </tbody></table>
      <Lines items={[["Team’s supporting grade", `${format(team.score)} out of 100`], ["Season games with market results", `${team.trackedGames} of ${team.seasonGames}`], ["Missing historical lines", team.missingGames]]} />
      <p>{team.opposing ? "Records show this opponent’s actual ATS results. Its failures to cover support the selected side, so the supporting rate is 100% minus its cover rate."
        : "The supporting rates use this team’s results in the direction of the selected play."}</p>
      <h5>Games behind these records</h5>
      <table className="fs-table"><thead><tr><th>Game</th><th>{side.market === "Spread" ? "Venue / line" : "Venue / market"}</th><th>Result</th></tr></thead><tbody>
        {(side.teamGames || []).filter(g => g.team === team.team).sort((a, b) => b.date.localeCompare(a.date)).map((game, i) => <tr key={`${game.date}-${i}`}>
          <th scope="row">{game.opponent}<small>{game.date}</small></th><td>{game.venue}<small>{game.line == null ? side.side : format(game.line, true)}</small></td><td>{game.result || "Pending"}</td></tr>)}
      </tbody></table>
    </Section>)}
    <Section title="Final grade calculation"><p>50% bet type + 30% venue + 20% last five produces each team’s supporting grade. The play grade averages both team grades using unrounded values.</p>
      <Lines items={[["Average of both team grades", `${format(score.score)} out of 100`], ["Evidence captured", time(score.capturedAt, true)], ["Weight version", score.version]]} />
      <p>Pushes are excluded from hit rates. An empty split contributes the existing neutral 50%. Missing season results leave the overall grade unavailable. Games can appear in several splits; those samples are not added together.</p>
    </Section>
  </>;
}
function PublicDetail({ side }: { side: FootballSignalSide }) {
  return <>
    <Lines items={[["Matching top-20 systems", side.publicMatches.length], ["Signals contributed", side.publicMatches.length ? 1 : 0], ["Ranking", "Current sport’s top 20 by Wilson score"],
      ["Historical eligibility", "Win rate above 60%; positive net profit"], ["Sample minimum", "Existing rules: no fixed minimum"]]} />
    {side.publicMatches.length ? side.publicMatches.map(match => <Section key={match.id} title={`#${match.rank} · ${match.label}`}>
      <Lines items={[["Wilson ranking score", format(match.wilsonScore)], ["Historical record", match.totals.record], ["Settled sample", match.totals.totalBets],
        ["Win rate", percent(match.totals.winPct)], ["Net units", format(match.totals.netUnits ?? match.totals.unitsWon, true)], ["ROI", percent(match.totals.roiPct)],
        ["Last 7 bets", match.lastSevenTotals?.record || "Unavailable"], ["Last 7 sample", match.lastSevenTotals?.totalBets ?? "Unavailable"]]} />
      <h5>Exact qualifying conditions</h5><ul className="fs-rules">{match.rules.map((rule, i) => <li key={i}>{rule}</li>)}</ul>
      <p>Selection: {match.selectionDescription}. All conditions use the existing catalog evaluator for this sport and market.</p>
    </Section>) : <Section title="No qualifying system match"><p>This side does not currently match an eligible system in its sport’s top 20 Wilson ranking. Matching lower-ranked systems do not activate this signal.</p></Section>}
    <Section title="Inputs used for these matches"><Lines items={[["Bets on this side", percent(side.marketContext.bets)], ["Money on this side", percent(side.marketContext.money)],
      ["Ticket share change", `${format(side.marketContext.publicChange, true)} percentage points`], ["Money share change", `${format(side.marketContext.moneyChange, true)} percentage points`],
      ["Current line", format(side.line, side.market === "Spread")], ["Opening line", format(side.marketContext.openingLine, side.market === "Spread")]]} />
      <p>Wilson uses the existing one-sided 95% lower bound. Pushes are excluded from its wins and losses. Each system retains its own historical record; overlapping systems are counted once as a public trend signal.</p>
    </Section>
  </>;
}
function SignalDetail({ side, signal, onClose }: { side: FootballSignalSide; signal: FootballSignal; onClose: () => void }) {
  const key = signal.key, context = side.marketContext;
  return <section className="fs-detail" role="region" id={`signal-detail-${side.id}-${key}`} aria-label={`${META[key].title} for ${side.selection}`}>
    <div className="fs-detail-head"><div><span className="fs-kicker">{side.selection}</span><h3>{META[key].title}</h3></div><button type="button" className="fs-close" onClick={onClose} aria-label="Collapse signal details"><X size={18} /></button></div>
    <div className="fs-detail-status"><strong>{signal.available ? key === "system" ? side.publicMatches.length ? "Match" : "No match" : format(signal.value, ["money", "move", "model", "sos"].includes(key)) : "Unavailable"}</strong><span>{signal.level}</span></div>
    <p>{signal.reason}</p>
    {key === "team" ? <TeamDetail side={side} /> : null}
    {key === "system" ? <PublicDetail side={side} /> : null}
    {key === "money" ? <>
      <Section title="Money support calculation"><Lines items={[["Bets on this side", percent(context.bets)], ["Money on this side", percent(context.money)],
        ["Money minus bets", `${format(signal.value, true)} percentage points`], ["Qualifying / strong / very strong", "+15 / +25 / +35"]]} /></Section>
      <Section title="Opening versus current support"><Lines items={[["Opening bets", percent(context.openingBets)], ["Opening money", percent(context.openingMoney)],
        ["Current bets", percent(context.bets)], ["Current money", percent(context.money)]]} /><p>Bet percentage measures tickets; money percentage measures dollars wagered. Both percentages come from the same market feed. Placeholder 100% / 100% observations do not qualify.</p></Section>
      <History side={side} />
    </> : null}
    {key === "move" ? <>
      <Section title="Existing movement classification"><Lines items={[["Classification", context.movementLabel || "Unavailable"], ["Movement basis", context.movementBasis || "Unavailable"],
        ["Movement toward this side", `${format(signal.value, true)} ${context.movementBasis === "Implied Probability" ? "percentage points" : "points"}`], ["Opening line", format(context.openingLine, side.market === "Spread")],
        ["Current line", format(side.line, side.market === "Spread")], ["Opening odds", context.openingOdds || "Unavailable"], ["Current odds", side.odds],
        ["Ticket share change", `${format(context.publicChange, true)} percentage points`]]} />
        <p>The badge follows the existing positive line movement or reverse line movement classification. Its direction, movement thresholds, usable opening observations, and market basis are preserved.</p>
      </Section><History side={side} />
    </> : null}
    {key === "model" ? <Section title="Existing model qualification"><Lines items={[["Qualifying model play", side.modelContext.play || "None available"], ["Grade", side.modelContext.grade || "Unavailable"],
      ["Model version", side.modelContext.version || "Unavailable"], ["Model projection", format(side.modelContext.projection, side.market === "Spread")], ["Model play line", format(side.modelContext.line, side.market === "Spread")],
      ["Current market line", format(side.line, side.market === "Spread")], ["Model probability", percent(side.modelContext.probability)], ["Current edge", `${format(signal.value, true)} points`]]} />
      <p>{side.modelContext.reason}</p><p>Existing sport-specific model grades determine qualification. A new generic points threshold is not applied.</p>
    </Section> : null}
    {key === "sos" ? <>
      <Section title="Warren Nolan current ELO SOS"><Lines items={side.sosContext.teams.flatMap(team => [[`${team.team} SOS rank`, `#${team.rank}`], [`${team.team} opponent ELO`, format(team.elo)], [`${team.team} opponents’ record`, team.opponentRecord]] as [string, string][])} />
        {!side.sosContext.teams.length ? <p>Fresh pregame schedule rankings are unavailable for one or both teams.</p> : null}
        <p>A lower rank means a tougher schedule. Spread advantage = opponent’s rank minus selected team’s rank. Totals show the absolute gap as context and receive no SOS vote.</p>
        <Lines items={[["Qualifying / strong / very strong", "+25 / +50 / +75 rank places"], ["Ranking captured", side.sosContext.capturedAt ? time(side.sosContext.capturedAt, true) : "Unavailable"]]} />
        {side.sosContext.sourceUrl ? <a href={side.sosContext.sourceUrl} target="_blank" rel="noreferrer">View Warren Nolan rankings</a> : null}
      </Section>
    </> : null}
    <Section title="Contribution to the 3+ test"><Lines items={[["This signal contributes", signal.active ? "1 signal" : "0 signals"], ["Total qualifying signals", side.signalCount],
      ["Primary source groups", side.sourceCount], ["Test requirement", "3+ signals and at least 2 source groups"], ["Decision", side.mixed ? "Mixed · no selection" : side.selected ? "Qualifying test selection" : "No test selection"],
      ["Snapshot", side.recorded ? "Saved pregame" : side.status === "LIVE" ? "Live preview" : "Not recorded for this test"], ["Snapshot time", time(side.snapshotAt, true)]]} />
      <p>Money, line movement, and public bet trends share the market group. Team trends and models are the other primary groups. CFB SOS adds supporting context.</p>
    </Section>
    <button type="button" className="fs-collapse" onClick={onClose}><ChevronUp size={16} />Collapse details</button>
  </section>;
}

export default function FootballSignals({ board }: { board?: FootballSignalsBoard }) {
  const [market, setMarket] = useState<"Spread" | "Total">("Spread");
  const [date, setDate] = useState(board?.today || ""), [query, setQuery] = useState("");
  const [onlyCandidates, setOnlyCandidates] = useState(false);
  const [sort, setSort] = useState<FootballSignalKey | "time">("time"), [direction, setDirection] = useState(-1);
  const [open, setOpen] = useState<{ id: string; key: FootballSignalKey } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const keys: FootballSignalKey[] = board?.sport === "NCAAF" ? ["money", "move", "system", "team", "model", "sos"] : ["money", "move", "system", "team", "model"];
  const dates = [...new Set([board?.today || "", ...(board?.sides || []).map(side => side.date)])].filter(Boolean).sort();
  const selectedDate = dates.includes(date) ? date : board?.today || "";
  const groups = useMemo(() => {
    const byGame = new Map<string, FootballSignalSide[]>();
    for (const side of board?.sides || []) {
      if (side.market !== market || side.date !== selectedDate || !side.game.toLowerCase().includes(query.toLowerCase())) continue;
      byGame.set(side.gameKey, [...(byGame.get(side.gameKey) || []), side]);
    }
    const value = (rows: FootballSignalSide[]) => Math.max(...rows.map(row => {
      const s = row.signals.find(s => s.key === sort); return s?.available && s.value != null ? s.value : -Infinity;
    }));
    return [...byGame.values()].filter(rows => !onlyCandidates || rows.some(row => row.selected))
      .sort((a, b) => {
        if (sort === "time" || value(a) === value(b)) return a[0].gameTime.localeCompare(b[0].gameTime);
        if (value(a) === -Infinity) return 1;
        if (value(b) === -Infinity) return -1;
        return (value(a) - value(b)) * direction;
      });
  }, [board, market, selectedDate, query, onlyCandidates, sort, direction]);
  if (!board) return <div className="fs-empty">Signals are awaiting the next successful board refresh.</div>;
  const close = () => { setOpen(null); trigger.current?.focus(); };
  return <section className={`fs-board ${keys.length === 6 ? "fs-six" : ""}`} aria-label={`${board.sport} Signals`}>
    <div className="fs-heading"><div><span className="fs-kicker">{board.sport === "NCAAF" ? "College football" : "NFL"}</span><h2>Signals</h2></div><span className="fs-test-label">3+ test</span></div>
    <p className="fs-description">Every matchup. Same qualifying rules. Tap a signal for its full breakdown.</p>
    {!board.captureAvailable ? <p className="fs-notice" role="status">Test capture is unavailable. Signals below are previews.</p> : null}
    <div className="fs-controls"><div className="fs-markets" role="group" aria-label="Market">{(["Spread", "Total"] as const).map(m => <button type="button" key={m} aria-pressed={market === m} onClick={() => { setMarket(m); setOpen(null); }}>{m === "Spread" ? "Spreads" : "Totals"}</button>)}</div>
      <label className="fs-date">Slate<select value={selectedDate} onChange={e => { setDate(e.target.value); setOpen(null); }}>{dates.map(d => <option key={d} value={d}>{new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(new Date(d + "T12:00:00Z"))}</option>)}</select></label>
    </div>
    <div className="fs-search-row"><label className="fs-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search teams" placeholder="Search teams" value={query} onChange={e => setQuery(e.target.value)} /></label><button type="button" className="fs-filter" aria-pressed={onlyCandidates} onClick={() => { setOnlyCandidates(value => !value); setOpen(null); }}>3+ only</button></div>
    <div className="fs-toolbar"><span aria-live="polite">{groups.length} {groups.length === 1 ? "game" : "games"} · {market === "Spread" ? "Spreads" : "Totals"}</span><button type="button" onClick={() => { setSort("time"); setOpen(null); }}><Clock3 size={13} />Game time</button></div>
    <div className="fs-sorters" role="group" aria-label="Sort games by signal">{keys.map(key => { const { Icon, label } = META[key]; return <button type="button" key={key} aria-pressed={sort === key} aria-label={`Sort by ${META[key].title}`} onClick={() => { setDirection(sort === key ? -direction : -1); setSort(key); setOpen(null); }}><Icon size={18} aria-hidden="true" /><span>{label}{sort === key ? direction < 0 ? " ↓" : " ↑" : ""}</span></button>; })}</div>
    <div className="fs-sort-caption" aria-live="polite">{sort === "time" ? "Game time order" : `${META[sort].title} · ${direction < 0 ? "highest" : "lowest"} first`}{sort === "sos" && market === "Total" ? " · context only" : ""}</div>
    <div className="fs-games">{groups.length ? groups.map(rows => <article className="fs-game" key={rows[0].gameKey}>
      <header className="fs-game-header"><span>{rows[0].game}</span><time dateTime={rows[0].gameTime}>{time(rows[0].gameTime)}</time></header>
      {rows.slice().sort((a, b) => market === "Total" ? (a.side === "Over" ? -1 : 1) : 0).map(side => <div className="fs-side" key={side.id}>
        <div className="fs-side-heading"><div className="fs-selection">{market === "Spread" ? <TeamLogoName sport={board.sport} team={side.selection.replace(/\s+[+−-]?\d+(?:\.\d+)?$/, "")} className="fs-team-name" /> : <strong>{side.side}</strong>}<strong>{format(side.line, market === "Spread")}</strong><small>{side.odds}</small></div><span className={side.selected ? "fs-count fs-qualified" : "fs-count"}>{side.signalCount} {side.signalCount === 1 ? "signal" : "signals"}{side.mixed ? " · Mixed" : side.selected ? " · Test" : ""}</span></div>
        <div className="fs-signals">{keys.map(key => { const s = side.signals.find(s => s.key === key), { Icon, title } = META[key]; if (!s) return null;
          const expanded = open?.id === side.id && open.key === key;
          const value = s.active ? key === "system" ? "Match" : s.value != null ? format(s.value, ["money", "move", "model", "sos"].includes(key)) : side.modelContext.grade.split(" ")[0]
            : key === "sos" && market === "Total" && s.available ? format(s.value) : "";
          return <button type="button" key={key} className={`fs-signal ${s.active ? "fs-on" : ""}`} aria-expanded={expanded} aria-controls={`signal-detail-${side.id}-${key}`} aria-label={`${side.selection}: ${title}. ${s.available ? s.active ? "Qualifying" : "Inactive" : "Unavailable"}. ${value}`} onClick={e => { trigger.current = e.currentTarget; setOpen(expanded ? null : { id: side.id, key }); }}><span className="fs-signal-box"><Icon size={22} aria-hidden="true" /></span><span className="fs-signal-value">{value}</span></button>;
        })}</div>
        <div className="fs-snapshot">{side.recorded ? `Saved pregame · ${time(side.snapshotAt)}` : side.status === "LIVE" ? `Live preview · ${time(side.snapshotAt)}` : side.status === "MISSED_LOCK" ? "Missed final snapshot" : side.status === "UNAVAILABLE" ? "Awaiting market data" : "Not recorded for this test"}{side.result ? ` · ${side.result}` : ""}</div>
        {open?.id === side.id ? <SignalDetail side={side} signal={side.signals.find(s => s.key === open.key)!} onClose={close} /> : null}
      </div>)}
    </article>) : <div className="fs-empty">No games match this view.</div>}</div>
    <div className="fs-legend"><span><i className="fs-legend-on" />Qualifying signal</span><span><i />Inactive or unavailable</span></div>
    <details className="fs-results"><summary>3+ test results <strong>{board.summary.record}</strong><span>{board.summary.settled} settled · {board.summary.pending} pending</span></summary>
      <Lines items={[["Win rate", percent(board.summary.winPct)], ["Net units", format(board.summary.netUnits, true)], ["ROI", percent(board.summary.roiPct)], ["Mode", "Prospective testing · existing EZPZ selection preserved"]]} />
      {board.breakdowns.length ? <table className="fs-table"><thead><tr><th>Group</th><th>Record / sample</th><th>ROI</th></tr></thead><tbody>{board.breakdowns.map(row => <tr key={`${row.dimension}-${row.label}`}><th scope="row">{row.label}<small>{row.dimension}</small></th><td>{row.record.record}<small>{row.record.settled} settled · {row.record.pending} pending</small></td><td>{percent(row.record.roiPct)}</td></tr>)}</tbody></table> : <p>Results appear after qualifying test selections are saved before kickoff and settled.</p>}
      {board.history.length ? <table className="fs-table"><thead><tr><th>Saved test play</th><th>Signals</th><th>Result</th></tr></thead><tbody>{board.history.map((row, i) => <tr key={`${row.date}-${row.selection}-${i}`}><th scope="row">{row.selection}<small>{row.game} · {row.date}</small></th><td>{row.signalCount}<small>{row.combination}</small></td><td>{row.result || "Pending"}</td></tr>)}</tbody></table> : null}
      <p>All signal observations are saved, including games that produce no test selection. Each settled test selection risks one unit at its saved odds.</p>
    </details>
  </section>;
}
