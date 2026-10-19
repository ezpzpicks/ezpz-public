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
function TeamDetail({ side }: { side: FootballSignalSide }) {
  const score = side.teamTrend;
  if (!score) return <p>Team records are awaiting a complete matchup and market line.</p>;
  return <>
    <p>Qualifies at 75. Each team’s grade uses 50% bet type, 30% venue and 20% last five, then both grades are averaged.</p>
    {score.teams.map(team => <Section key={team.team} title={`${team.team} · supporting grade ${format(team.score)}`}>
      <table className="fs-table"><thead><tr><th>Trend</th><th>Record</th></tr></thead><tbody>
        {Object.entries(team.records).map(([key, record]) => <tr key={key}><th scope="row">{record.label}</th>
          <td>{record.sample ? record.record : "No matching games"}</td></tr>)}
      </tbody></table>
      {team.opposing ? <p>{team.team}’s ATS losses support this play.</p> : null}
      {team.missingGames ? <p>Market results missing for {team.missingGames} season {team.missingGames === 1 ? "game" : "games"}.</p> : null}
    </Section>)}
  </>;
}
function PublicDetail({ side }: { side: FootballSignalSide }) {
  const current = side.signals.find(signal => signal.key === "system")!;
  return <>
    <p>Uses this sport’s top 20 Wilson-ranked trends. Multiple matches count as one public signal.</p>
    {side.publicMatches.length ? side.publicMatches.map(match => <Section key={match.id} title={`#${match.rank} · ${match.label}`}>
      <Lines items={[["Overall record", match.totals.record], ["Last 7 bets", match.lastSevenTotals?.record || "Unavailable"],
        ["Win rate", percent(match.totals.winPct)], ["Net units", format(match.totals.netUnits ?? match.totals.unitsWon, true)], ["ROI", percent(match.totals.roiPct)]]} />
    </Section>) : <p>{current.available
      ? "No qualifying top-20 trend matches this side."
      : current.reason}</p>}
  </>;
}
function SignalDetail({ side, signal, onClose }: { side: FootballSignalSide; signal: FootballSignal; onClose: () => void }) {
  const key = signal.key, context = side.marketContext;
  const magnitude = !signal.available ? "Unavailable" : key === "system" ? side.publicMatches.length ? "Match" : "No match"
    : key === "team" ? `${format(signal.value)} out of 100`
    : signal.value == null ? signal.active ? "Qualifying" : "Inactive"
    : `${format(signal.value, ["money", "move", "model", "sos"].includes(key))}${key === "money" || (key === "move" && context.movementBasis === "Implied Probability") ? " percentage points" : key === "sos" ? " rank places" : " points"}`;
  return <section className="fs-detail" role="region" id={`signal-detail-${side.id}-${key}`} aria-label={`${META[key].title} for ${side.selection}`}>
    <div className="fs-detail-head"><div><span className="fs-kicker">{side.selection}</span><h3>{META[key].title}</h3></div><button type="button" className="fs-close" onClick={onClose} aria-label="Collapse signal details"><X size={18} /></button></div>
    <div className="fs-detail-status"><strong>{magnitude}</strong><span>{signal.level}</span></div>
    {key === "team" ? <TeamDetail side={side} /> : null}
    {key === "system" ? <PublicDetail side={side} /> : null}
    {key === "money" ? <>
      <Lines items={[["Bets on this side", percent(context.bets)], ["Money on this side", percent(context.money)]]} />
      <p>Money minus bets. Qualifies at +15; strong at +25; very strong at +35 percentage points.</p>
      {!signal.available ? <p>Valid ticket and money percentages are unavailable.</p> : null}
    </> : null}
    {key === "move" ? <>
      <Lines items={context.movementBasis === "Implied Probability"
        ? [["Opening odds", context.openingOdds || "Unavailable"], ["Current odds", side.odds || "Unavailable"]]
        : [["Opening line", format(context.openingLine, side.market === "Spread")], ["Current line", format(side.line, side.market === "Spread")]]} />
      <p>{!signal.available ? "Line movement data is unavailable." : signal.active
        ? "Movement supports this side under the existing line movement rules."
        : "Movement does not qualify for this side under the existing rules."}</p>
    </> : null}
    {key === "model" ? <>
      {signal.available ? <Lines items={[["Qualifying model play", side.modelContext.play || "None on this side"], ["Model grade", side.modelContext.grade || "Unavailable"],
        ["Model projection", format(side.modelContext.projection, side.market === "Spread")], ["Current line", format(side.line, side.market === "Spread")]]} /> : null}
      <p>{side.modelContext.reason}</p>
    </> : null}
    {key === "sos" ? <>
      <Lines items={side.sosContext.teams.map(team => [`${team.team} SOS rank`, `#${team.rank}`])} />
      {!side.sosContext.teams.length ? <p>Fresh schedule rankings are unavailable for one or both teams.</p> : null}
      <p>Lower rank means a tougher schedule. {side.market === "Total" ? "The gap is context only for totals and adds no signal." : "Qualifies at +25; strong at +50; very strong at +75 rank places."}</p>
      {side.sosContext.sourceUrl ? <a href={side.sosContext.sourceUrl} target="_blank" rel="noreferrer">Warren Nolan current ELO SOS</a> : null}
    </> : null}
    <p className="fs-detail-foot">{signal.active ? "Adds 1 signal" : "Adds no signal"} · {side.signalCount} total · {side.recorded ? "Saved pregame" : side.status === "LIVE" ? "Live preview" : "Not recorded for this test"} · {time(side.snapshotAt)}</p>
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
  return <section className={`fs-board ${keys.length === 6 ? "fs-six" : ""}`} aria-label={`${board.sport} Signals`} onKeyDown={e => { if (e.key === "Escape" && open) { close(); e.preventDefault(); } }}>
    <div className="fs-heading"><div><span className="fs-kicker">{board.sport === "NCAAF" ? "College football" : "NFL"}</span><h2>Signals</h2></div><span className="fs-test-label">3+ test</span></div>
    <p className="fs-description">Every matchup. Same qualifying rules. Tap a signal for the key details.</p>
    {!board.captureAvailable ? <p className="fs-notice" role="status">Test capture is unavailable. Signals below are previews.</p> : null}
    <div className="fs-controls"><div className="fs-markets" role="group" aria-label="Market">{(["Spread", "Total"] as const).map(m => <button type="button" key={m} aria-pressed={market === m} onClick={() => { setMarket(m); setOpen(null); }}>{m === "Spread" ? "Spreads" : "Totals"}</button>)}</div>
      <label className="fs-date">Slate<select value={selectedDate} onChange={e => { setDate(e.target.value); setOpen(null); }}>{dates.map(d => <option key={d} value={d}>{new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(new Date(d + "T12:00:00Z"))}</option>)}</select></label>
    </div>
    <div className="fs-search-row"><label className="fs-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search teams" placeholder="Search teams" value={query} onChange={e => { setQuery(e.target.value); setOpen(null); }} /></label><button type="button" className="fs-filter" aria-pressed={onlyCandidates} onClick={() => { setOnlyCandidates(value => !value); setOpen(null); }}>3+ only</button></div>
    <div className="fs-toolbar"><span aria-live="polite">{groups.length} {groups.length === 1 ? "game" : "games"} · {market === "Spread" ? "Spreads" : "Totals"}</span><button type="button" onClick={() => { setSort("time"); setOpen(null); }}><Clock3 size={13} />Game time</button></div>
    <div className="fs-sorters" role="group" aria-label="Sort games by signal">{keys.map(key => { const { Icon, label } = META[key]; return <button type="button" key={key} aria-pressed={sort === key} aria-label={`Sort by ${META[key].title}`} onClick={() => { setDirection(sort === key ? -direction : -1); setSort(key); setOpen(null); }}><Icon size={18} aria-hidden="true" /><span>{label}{sort === key ? direction < 0 ? " ↓" : " ↑" : ""}</span></button>; })}</div>
    <div className="fs-sort-caption" aria-live="polite">{sort === "time" ? "Game time order" : `${META[sort].title} · ${direction < 0 ? "highest" : "lowest"} first`}{sort === "sos" && market === "Total" ? " · context only" : ""}</div>
    <div className="fs-games">{groups.length ? groups.map(rows => <article className="fs-game" key={rows[0].gameKey}>
      <header className="fs-game-header"><span>{rows[0].game}</span><time dateTime={rows[0].gameTime}>{time(rows[0].gameTime)}</time></header>
      {rows.slice().sort((a, b) => market === "Total" ? (a.side === "Over" ? -1 : 1) : 0).map(side => <div className="fs-side" key={side.id}>
        <div className="fs-side-heading"><div className="fs-selection">{market === "Spread" ? <TeamLogoName sport={board.sport} team={side.selection.replace(/\s+[+−-]?\d+(?:\.\d+)?$/, "")} className="fs-team-name" /> : <strong>{side.side}</strong>}<strong>{side.line == null ? "Line pending" : format(side.line, market === "Spread")}</strong><small>{side.odds}</small></div><span className={side.selected ? "fs-count fs-qualified" : "fs-count"}>{side.signalCount} {side.signalCount === 1 ? "signal" : "signals"}{side.mixed ? " · Mixed" : side.selected ? " · Test" : ""}</span></div>
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
