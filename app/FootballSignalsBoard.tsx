"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, TrendingUp, FlaskConical, Users, Calculator, Mountain, Search, X, ChevronDown, SlidersHorizontal } from "lucide-react";
import { TeamLogoName } from "./TeamLogoName";
import NbaGameLineups from "./NbaGameLineups";
import type { NbaGameLineup } from "../lib/nbaLineupsCore";
import type { FootballSignalKey, FootballSignalSide, FootballSignalsBoard, FootballSignal } from "../lib/footballSignals";
import { selectSignalEzpzPicks, signalPickThreshold, comboPickPolicy } from "../lib/signalPicks";
import { signalResearchView, signalCombinationLabel, signalCombinationRecord, signalResearchSideGroup, type ResearchPhase, type SignalResearchReport } from "../lib/signalCombinationResearch";
import { evaluateSignalMovement } from "../lib/signalMovement";

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
  const awaitingSpread = side.market === "Spread" && side.line == null;
  return <>
    {awaitingSpread ? <p>Favorite/underdog records and the grade await the line.</p> : null}
    {score.score == null && score.teams.some(team => team.missingGames > 0)
      ? <p>The combined grade is awaiting complete history. Available records are shown below.</p> : null}
    <div className="fs-team-grid">{score.teams.map(team => <section className="fs-team-card" key={team.team} aria-label={`${team.team} trend records`}>
      <div className="fs-team-card-head"><h4>{team.team}</h4>{team.hasData === false ? <span>Awaiting graded history</span>
        : !awaitingSpread ? <div><strong>{format(team.score)}</strong><small>{team.missingGames ? "Partial grade" : "Support score"}</small></div> : null}</div>
      <table className="fs-table"><tbody>
        {Object.entries(team.records).map(([key, record]) => <tr key={key}><th scope="row">{record.label}</th>
          <td>{record.sample ? record.record : "No matching games"}</td></tr>)}
      </tbody></table>
      {team.missingGames ? <p>Market results missing for {team.missingGames} season {team.missingGames === 1 ? "game" : "games"}.</p> : null}
    </section>)}</div>
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
function SignalDetail({ side, signal, onClose, liveNba = false, inline = false }: { side: FootballSignalSide; signal: FootballSignal; onClose: () => void; liveNba?: boolean; inline?: boolean }) {
  const key = signal.key, context = side.marketContext;
  const movement = key === "move" ? context.movement || evaluateSignalMovement({ market: side.market, side: side.side,
    openingLine: context.openingLine, line: side.line, retainedBasis: context.movementBasis,
    retainedValue: signal.value, retainedLabel: context.movementLabel }) : null;
  const legacyMovement = key === "move" && side.recorded && !context.movement && context.movementBasis === "Implied Probability";
  const available = key === "move" && !side.recorded ? movement?.available === true : signal.available;
  const magnitude = !available ? key === "team" && side.teamTrend
    ? side.market === "Spread" && side.line == null ? "Awaiting spread" : "Awaiting complete history"
    : "Unavailable" : key === "system" ? side.publicMatches.length ? "Match" : "No match"
    : key === "team" ? format(signal.value)
    : key === "move" ? movement?.lineChange == null ? "Unavailable" : format(movement.lineChange, true)
    : signal.value == null ? signal.active ? "Qualifying" : "Inactive"
    : format(signal.value, ["money", "model", "sos"].includes(key));
  const tone = !available ? "neutral" : key === "money" ? (signal.value || 0) > 0 ? "positive" : (signal.value || 0) < 0 ? "negative" : "neutral"
    : key === "move" ? movement?.state || "neutral" : key === "team" ? signal.active ? "positive" : "warning" : signal.active ? "positive" : "neutral";
  const status = legacyMovement ? "Saved signal" : signal.active ? key === "money" ? signal.level : "Qualifying"
    : !available ? "Unavailable" : key === "money" ? "Below +15" : key === "team" ? "Below 75" : "No signal";
  const unit = key === "team" ? "/100" : key === "move" ? movement?.lineChange == null ? "" : Math.abs(movement.lineChange) === 1 ? "point" : "points"
    : key === "sos" ? "rank places" : key === "model" && signal.value != null ? "points" : "";
  const { Icon } = META[key];
  return <section className={`fs-detail fs-detail-${key} fs-tone-${tone}${inline ? " fs-detail-inline" : ""}`} role="region" id={`signal-detail-${encodeURIComponent(side.id)}-${key}`} aria-label={`${META[key].title} for ${side.selection}`}>
    {!inline ? <div className="fs-detail-head"><div className="fs-detail-title"><span className="fs-detail-icon"><Icon size={20} aria-hidden="true" /></span><div><span className="fs-kicker">{side.selection}</span><h3>{META[key].title}</h3></div></div><button type="button" className="fs-close" onClick={onClose} aria-label="Collapse signal details"><X size={18} /></button></div> : null}
    <div className="fs-detail-status"><div className="fs-metric"><strong>{magnitude}</strong>{unit && available ? <small>{unit}</small> : null}</div><span className={`fs-state${signal.active ? " fs-state-active" : ""}`}>{status}</span></div>
    {key === "team" ? <>
      {signal.available && signal.value != null ? <div className="fs-score-meter" aria-label={`Team trend score ${format(signal.value)} out of 100. Qualifies at 75.`}>
        <div className="fs-meter-track" role="meter" aria-label="Team trend score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={signal.value}>
          <span style={{ width: `${Math.max(0, Math.min(100, signal.value))}%` }} /><i style={{ left: "75%" }} /></div><span className="fs-meter-target">Qualifies at 75</span>
      </div> : null}
      <TeamDetail side={side} />
    </> : null}
    {key === "system" ? <PublicDetail side={side} /> : null}
    {key === "money" ? <>
      <span className="fs-metric-caption">Money − bets</span>
      <dl className="fs-share-bars">{([["Bets", context.bets], ["Money", context.money]] as const).map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd><span className={`fs-share-track${label === "Money" ? " fs-share-money" : ""}`} aria-hidden="true"><span style={{ width: `${value == null ? 0 : Math.max(0, Math.min(100, value))}%` }} /></span><strong>{percent(value)}</strong></dd></div>)}</dl>
      <details className="fs-method"><summary>Signal starts at +15</summary><p>Money minus bets. Strong at +25; very strong at +35.</p></details>
      {!signal.available ? <p>Valid ticket and money percentages are unavailable.</p> : null}
    </> : null}
    {key === "move" ? <>
      <dl className="fs-quote-pair"><div><dt>Opening line</dt><dd>{format(context.openingLine, side.market === "Spread")}</dd></div><span aria-hidden="true">→</span><div><dt>{side.recorded ? "Saved line" : "Current line"}</dt><dd>{format(side.line, side.market === "Spread")}</dd></div></dl>
      {movement?.usesHistory ? <>
        <span className="fs-metric-caption">Most recent recorded move</span>
        <p>{side.recorded && !signal.available
          ? "Line-history evidence was not counted when this pregame snapshot was saved. The correction applies to new snapshots; the historical vote is preserved."
          : "The line returned to its opening number. This signal uses the feed's classification of the most recent recorded move."}</p>
      </> : null}
      {legacyMovement ? <p>Saved under the earlier movement rule.</p> : !movement?.usesHistory ? <span className="fs-metric-caption">{!available ? "Opening or current line unavailable" : movement?.state === "positive"
        ? "Moved toward this side" : movement?.state === "negative" ? "Moved against this side"
          : movement?.lineChange ? "Below 0.5-point threshold" : "Line unchanged"}</span> : null}
    </> : null}
    {key === "model" ? <>
      {signal.available ? <Lines items={[[side.modelContext.regraded ? "Evaluated model play" : "Qualifying model play", side.modelContext.play || "None on this side"], ["Model grade", side.modelContext.grade || "Unavailable"],
        ["Model projection", format(side.modelContext.projection, side.market === "Spread")], ["Current line", format(side.line, side.market === "Spread")]]} /> : null}
      {side.modelContext.regraded ? <Lines items={[["Original model play", side.modelContext.originalPlay || "Unavailable"],
        ["Original model grade", side.modelContext.originalGrade || "Unavailable"],
        [side.modelContext.probabilityEstimated ? "Probability estimate at this line" : "Model probability", side.modelContext.probability == null ? "Unavailable" : percent(side.modelContext.probability * 100)]]} /> : null}
      <p>{side.recorded && side.modelContext.reason.includes("awaiting model re-evaluation")
        ? "The model signal was inactive when this pregame snapshot was saved. This historical vote is preserved; changed lines are re-evaluated on new snapshots."
        : side.modelContext.reason}</p>
    </> : null}
    {key === "sos" ? <>
      <Lines items={side.sosContext.teams.map(team => [`${team.team} SOS rank`, /^0-0(?:-0)?$/.test(team.opponentRecord) ? "Awaiting played opponents" : `#${team.rank}`])} />
      {side.sosContext.sourceUrl.includes("/basketball/") ? <Lines items={side.sosContext.teams.map(team => [`${team.team} team ELO`, String(team.elo)])} /> : null}
      {!side.sosContext.teams.length ? <p>Fresh schedule rankings are unavailable for one or both teams.</p> : null}
      <p>Lower rank means a tougher schedule. {side.sosContext.sourceUrl.includes("/basketball/") ? "NCAAM schedule strength and team ELO are context while this sport is calibrated." : side.market === "Total" ? "The gap is context only for totals and adds no signal." : "Qualifies at +25; strong at +50; very strong at +75 rank places."}</p>
      {side.sosContext.sourceUrl ? <a href={side.sosContext.sourceUrl} target="_blank" rel="noreferrer">{side.sosContext.sourceUrl.includes("/basketball/") ? "Warren Nolan current RPI SOS" : "Warren Nolan current ELO SOS"}</a> : null}
    </> : null}
    {!inline ? <p className="fs-detail-foot">{signal.active ? "Adds 1 signal" : "Adds no signal"} · {side.signalCount} total · {side.recorded ? "Saved pregame" : side.status === "LIVE" ? "Live preview" : liveNba ? "No saved pregame snapshot" : "Not recorded for this test"} · {time(side.snapshotAt)}</p> : null}
  </section>;
}

function CombinationRecord({ side, report, legacyReport }: { side: FootballSignalSide; report?: SignalResearchReport; legacyReport?: SignalResearchReport }) {
  const record = signalCombinationRecord(report, side) || signalCombinationRecord(legacyReport, side);
  const frozen = side.comboScore?.own;
  const frozenSettled = frozen ? frozen.wins + frozen.losses + frozen.pushes : 0;
  const displayRecord = record?.settled ? record.record : frozenSettled ? `${frozen!.wins}–${frozen!.losses}–${frozen!.pushes}` : "—";
  const label = record ? signalCombinationLabel(record.combination) : frozen ? signalCombinationLabel(frozen.combination) : "Signal combination";
  const description = `${label} · ${signalResearchSideGroup(side) || "Side unavailable"} · ${side.market === "Spread" ? "Spreads" : "Totals"} · Cumulative saved history · ${record?.settled
    ? `${record.record} (wins-losses-pushes) · ${record.pending} pending`
    : frozenSettled ? `${displayRecord} (wins-losses-pushes) · Saved scoring history` : record?.pending ? `No settled history · ${record.pending} pending` : "No settled history"}`;
  return <div className="fs-combination-record" title={description} aria-label={`Combined Signal Record: ${description}`}><span>Combined Signal Record</span><strong>{displayRecord}</strong></div>;
}

function MatchupCard({ rows, board, picksOnly, report, date, lineups }: {
  rows: FootballSignalSide[]; board: FootballSignalsBoard; picksOnly: boolean; report?: SignalResearchReport;
  date: string; lineups?: NbaGameLineup[];
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(rows[0].id);
  const [expandedKey, setExpandedKey] = useState<FootballSignalKey | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const side = rows.find(row => row.id === selectedId) || rows[0];
  const keys: FootballSignalKey[] = board.sport === "NCAAF" ? ["money", "move", "system", "team", "model", "sos"] : ["money", "move", "system", "team", "model"];
  const recorded = rows.every(row => row.recorded);
  const id = `matchup-details-${encodeURIComponent(rows[0].id)}`;
  const closeSignal = () => { setExpandedKey(null); trigger.current?.focus(); };
  const sideLabel = (value: FootballSignalSide) => value.market === "Total" ? value.side : value.selection.replace(/\s+[+−-]?\d+(?:\.\d+)?$/, "");
  return <article className={`fs-game${picksOnly ? " fs-official-pick" : ""}`} aria-label={picksOnly ? `${rows[0].selection} EZPZ Pick` : `${rows[0].game} signals`}>
    <header className="fs-game-header"><strong>{rows[0].game}</strong><time dateTime={rows[0].scheduledGameTime || rows[0].gameTime}>{time(rows[0].scheduledGameTime || rows[0].gameTime)}</time></header>
    <div className="fs-game-status"><span title={`Captured ${time(rows[0].snapshotAt)}`}>{recorded ? "Final snapshot" : rows.some(value => value.lineSource) ? "Saved market line" : rows.every(value => value.status === "MISSED_LOCK") ? "Missed final snapshot" : "Live preview"}</span>{picksOnly ? <span className="fs-pick-label">EZPZ PICK</span> : null}</div>
    {rows.map(value => {
      const signals = value.signals.filter(signal => signal.active && signal.available);
      return <div className="fs-side" key={value.id}>
        <div className="fs-side-heading"><div className="fs-selection">{value.market === "Spread" ? <TeamLogoName sport={board.sport} team={sideLabel(value)} className="fs-team-name" /> : <strong>{value.side}</strong>}<strong>{value.line == null ? "Line pending" : format(value.line, value.market === "Spread")}</strong></div><span className="fs-odds">{value.odds}</span></div>
        <div className="fs-summary-signals">{signals.map(signal => <span className="fs-signal-chip" key={signal.key}>{META[signal.key].label}</span>)}<span className="fs-count">{value.signalCount} {value.signalCount === 1 ? "signal" : "signals"}{value.mixed ? " · Mixed" : !picksOnly && value.selected ? " · EZPZ" : ""}</span>
          {value.comboScore && comboPickPolicy(board.sport, value.date) ? <span className="fs-score-label">Score {format(value.comboScore.score)}</span> : null}
          {value.result ? <span className={`fs-result fs-result-${value.result}`}>{value.result === "W" ? "Won" : value.result === "L" ? "Lost" : "Push"}</span> : null}
        </div>
        <CombinationRecord side={value} report={report} legacyReport={board.legacyResearch} />
        {value.lineSource ? <small className="fs-source-note">Saved {value.lineSource.name} line · {time(value.lineSource.capturedAt)} · −110 assumed · Public betting splits unavailable</small> : null}
      </div>;
    })}
    <button type="button" className="fs-details-toggle" aria-expanded={detailsOpen} aria-controls={id} onClick={() => { setDetailsOpen(value => !value); setExpandedKey(null); }}>Details<ChevronDown size={17} aria-hidden="true" /></button>
    {detailsOpen ? <div className="fs-breakdown" id={id} onKeyDown={event => { if (event.key === "Escape" && expandedKey) { closeSignal(); event.preventDefault(); } }}>
      {rows.length > 1 ? <div className="fs-side-selector" role="group" aria-label="Selection details">{rows.map(value => <button type="button" key={value.id} aria-pressed={side.id === value.id} onClick={() => { setSelectedId(value.id); setExpandedKey(null); }}>{sideLabel(value)}</button>)}</div> : null}
      <h3>Signal Breakdown</h3>
      <div className="fs-accordion-list">{keys.map(key => {
        const signal = side.signals.find(value => value.key === key) || { key, active: false, available: false, value: null, level: "Unavailable", reason: "Signal data is unavailable for this selection." };
        const expanded = expandedKey === key;
        return <div className="fs-accordion" key={key}>
          <button type="button" className="fs-accordion-trigger" aria-expanded={expanded} aria-controls={`signal-detail-${encodeURIComponent(side.id)}-${key}`} aria-label={`${side.selection}: ${META[key].title}. ${signal.active ? "Active" : signal.available ? "Inactive" : "Unavailable"}.`} onClick={event => { trigger.current = event.currentTarget; setExpandedKey(expanded ? null : key); }}>
            <i className={signal.active ? "fs-dot-active" : ""} aria-hidden="true" /><span>{META[key].title}<ChevronDown size={17} aria-hidden="true" /></span><small className={signal.active ? "fs-active-status" : ""}>{signal.active ? "Active" : signal.available ? "Inactive" : "Unavailable"}</small>
          </button>
          {expanded ? <>
            <SignalDetail side={side} signal={signal} onClose={closeSignal} liveNba={board.sport === "NBA" || board.sport === "NCAAM"} inline />
            {key === "model" && (board.sport === "NBA" || board.sport === "NCAAM") ? <NbaGameLineups sport={board.sport} game={side.game} date={date} lineups={lineups} /> : null}
          </> : null}
        </div>;
      })}</div>
    </div> : null}
  </article>;
}

function CombinationResearch({ report, market, scopeLabel = "Cumulative" }: { report?: SignalResearchReport; market: "Spread" | "Total"; scopeLabel?: string }) {
  const [phase, setPhase] = useState<ResearchPhase | "all">("all");
  const view = useMemo(() => report ? signalResearchView(report, market, phase) : null, [report, market, phase]);
  if (!report || !view) return null;
  const sample = (value: typeof view.total) => <>{value.samples ? value.record : "No observations"}
    <small>{value.settled} settled · {value.pending} pending{value.settled ? ` · ${format(value.netUnits, true)}u` : ""}</small></>;
  const rows = (items: { label: string; record: typeof view.total }[]) => <table className="fs-table">
    <thead><tr><th scope="col">Signals</th><th scope="col">Record / sample</th><th scope="col">ROI</th></tr></thead>
    <tbody>{items.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td data-label="Record / sample">{sample(row.record)}</td><td data-label="ROI">{percent(row.record.roiPct)}</td></tr>)}</tbody>
  </table>;
  return <details className="fs-results fs-research">
    <summary>Signal combination research <span>1 · 2 · 3+ signals · {market === "Spread" ? "Spreads" : "Totals"}</span></summary>
    <div className="fs-markets" role="group" aria-label="Research period">
      {([["all", "All saved"], ["history", "Earlier history"], ["forward", "Forward test"]] as const).map(([value, label]) =>
        <button type="button" key={value} aria-pressed={phase === value} onClick={() => setPhase(value)}>{label}</button>)}
    </div>
    <p>{scopeLabel} {report.sport} {market === "Spread" ? "spreads" : "totals"} · {view.total.samples} saved side observations across {report.dates.length} saved slates.
      Forward testing begins {time(report.forwardFrom, true)}. Earlier history is shown separately so it cannot be mistaken for later confirmation.</p>
    <h3>Signal counts</h3>
    {rows(view.counts.map(row => ({ label: `${row.label} ${row.label === "1" ? "signal" : "signals"}`, record: row.record })))}
    <h3>Exact combinations</h3>
    <p>Each row includes only that exact set of active signals. Plays with an additional signal belong to their own combination.</p>
    {view.exact.length ? rows(view.exact.map(row => ({ label: signalCombinationLabel(row.combination), record: row.record })))
      : <p>No saved two-signal or three-plus-signal observations in this view yet.</p>}
    {view.individual.length ? <>
      <h3>Individual signal baselines</h3>
      <p>Every saved side matching that signal, including sides with additional signals. These samples overlap; the comparison does not prove that adding a signal caused better returns.</p>
      {rows(view.individual.map(row => ({ label: row.label, record: row.record })))}
    </> : null}
    <p>Research only. Both sides and multiple markets can appear; this is not a one-pick-per-game betting card.
      Each settled observation risks one unit at its frozen odds. Pending results do not enter ROI.</p>
    <p>{view.total.assumedPrices} observations use assumed prices; {view.total.unknownPrices} have unverified price provenance.
      Positive observed ROI does not automatically qualify a combination for EZPZ picks.</p>
  </details>;
}

export default function FootballSignals({ board, picksOnly = false, sport: fallbackSport, selectedDate: controlledDate, onDateChange, lineups }: { board?: FootballSignalsBoard; picksOnly?: boolean; sport?: string; selectedDate?: string; onDateChange?: (date: string) => void; lineups?: NbaGameLineup[] }) {
  const [market, setMarket] = useState<"All" | "Spread" | "Total">(picksOnly ? "All" : "Spread");
  const [date, setDate] = useState(board?.today || ""), [query, setQuery] = useState("");
  const [onlyCandidates, setOnlyCandidates] = useState(false);
  const [sort, setSort] = useState<FootballSignalKey | "time" | "score">("time"), [direction, setDirection] = useState(-1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [archive, setArchive] = useState<{ key: string; status: "loading" | "ready" | "error"; sides: FootballSignalSide[]; research?: SignalResearchReport; lineups?: NbaGameLineup[] } | null>(null);
  const [archiveRetry, setArchiveRetry] = useState(0);
  const keys: FootballSignalKey[] = board?.sport === "NCAAF" ? ["money", "move", "system", "team", "model", "sos"] : ["money", "move", "system", "team", "model"];
  const dates = [...new Set([board?.today || "", ...(board?.sides || []).map(side => side.date), ...(board?.archiveDates || [])])].filter(Boolean).sort();
  const requestedDate = controlledDate || date;
  const selectedDate = dates.includes(requestedDate) ? requestedDate : board?.today || "";
  const sport = board?.sport || fallbackSport, scorePolicy = comboPickPolicy(sport || "", selectedDate);
  const calibrationPending = sport === "NCAAM" && !scorePolicy;
  const threshold = scorePolicy?.threshold ?? signalPickThreshold(sport), archiveKey = `${sport}:${selectedDate}`;
  const needsArchive = Boolean(board && selectedDate !== board.today && ((selectedDate < board.today && board.archiveDates?.includes(selectedDate)) || !board.sides.some(side => side.date === selectedDate)));
  const archiveReady = archive?.key === archiveKey && archive.status === "ready";
  const archiveError = archive?.key === archiveKey && archive.status === "error";
  const rawSides = needsArchive ? archiveReady ? archive!.sides : [] : board?.sides || [];
  const viewSides = useMemo(() => {
    const selected = new Set(selectSignalEzpzPicks(rawSides, sport || "").map(side => side.id));
    return rawSides.map(side => ({ ...side, selected: selected.has(side.id) }));
  }, [rawSides, sport]);
  useEffect(() => {
    if (!needsArchive || !sport) return;
    const controller = new AbortController();
    setArchive({ key: archiveKey, status: "loading", sides: [] });
    async function loadArchive() {
      try {
        const response = await fetch(`/api/${sport === "NCAAM" ? "ncaam" : sport === "NBA" ? "nba" : "football"}-signals-history?sport=${sport}&date=${selectedDate}`, { signal: controller.signal });
        const value = await response.json();
        if (!response.ok || !value.ok || value.sport !== sport || value.date !== selectedDate || !Array.isArray(value.sides)) throw new Error("Saved slate unavailable");
        if (!controller.signal.aborted) setArchive({ key: archiveKey, status: "ready", sides: value.sides, research: value.research, lineups: value.lineups });
      } catch {
        if (!controller.signal.aborted) setArchive({ key: archiveKey, status: "error", sides: [] });
      }
    }
    void loadArchive();
    return () => controller.abort();
  }, [needsArchive, sport, selectedDate, archiveKey, archiveRetry]);
  const groups = useMemo(() => {
    const byGame = new Map<string, FootballSignalSide[]>();
    for (const side of viewSides) {
      if ((market !== "All" && side.market !== market) || side.date !== selectedDate || !side.game.toLowerCase().includes(query.toLowerCase())
        || (picksOnly && !side.selected)) continue;
      byGame.set(side.gameKey, [...(byGame.get(side.gameKey) || []), side]);
    }
    const value = (rows: FootballSignalSide[]) => Math.max(...rows.map(row => {
      if (sort === "score") return row.comboScore?.score ?? -Infinity;
      const s = row.signals.find(s => s.key === sort); return s?.available && s.value != null ? s.value : -Infinity;
    }));
    return [...byGame.values()].filter(rows => !onlyCandidates || rows.some(row => calibrationPending ? row.signalCount > 0 : row.selected))
      .sort((a, b) => {
        if (sort === "time" || value(a) === value(b)) return (a[0].scheduledGameTime || a[0].gameTime).localeCompare(b[0].scheduledGameTime || b[0].gameTime);
        if (value(a) === -Infinity) return 1;
        if (value(b) === -Infinity) return -1;
        return (value(a) - value(b)) * direction;
      });
  }, [viewSides, market, selectedDate, query, onlyCandidates, sort, direction, picksOnly, calibrationPending]);
  if (!board) return picksOnly ? <section className="fs-board ep-board" aria-label={`${sport} EZPZ Picks`}><div className="fs-heading ep-heading"><h2>{sport} EZPZ Picks</h2></div>
    <div className="fs-empty">No qualifying {sport} EZPZ Picks yet. Saved signal tests are awaiting the next successful board refresh.</div></section>
    : <div className="fs-empty">Signals are awaiting the next successful board refresh.</div>;
  const liveNba = board.sport === "NBA" || board.sport === "NCAAM";
  const resultPolicy = comboPickPolicy(board.sport, board.today);
  return <section className={`fs-board${picksOnly ? " ep-board" : ""}`} aria-label={`${board.sport} ${picksOnly ? "EZPZ Picks" : "Signals"}`}>
    <div className="fs-heading"><h2>{picksOnly ? `${board.sport} EZPZ Picks` : "Signals"}</h2></div>
    {!board.captureAvailable ? <p className="fs-notice" role="status">{liveNba ? "Pregame capture is unavailable. Signals below are previews." : "Test capture is unavailable. Signals below are previews."}</p> : null}
    {picksOnly ? <div className="fs-picks-summary" aria-label={resultPolicy ? "EZPZ record" : "Saved signal test record"}><span>{resultPolicy ? "EZPZ record" : "Saved signal tests"}<strong>{board.summary.record}</strong></span><span>Units<strong>{format(board.summary.netUnits, true)}u</strong></span><span>ROI<strong>{percent(board.summary.roiPct)}</strong></span></div> : null}
    <div className="fs-controls"><div className="fs-markets" role="group" aria-label="Market">{(picksOnly ? ["All", "Spread", "Total"] as const : ["Spread", "Total"] as const).map(value => <button type="button" key={value} aria-pressed={market === value} onClick={() => setMarket(value)}>{value === "All" ? "All plays" : value === "Spread" ? "Spreads" : "Totals"}</button>)}</div>
      <button type="button" className="fs-filter" aria-expanded={filtersOpen} aria-controls="signal-filters" onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={16} aria-hidden="true" />Filters{query || onlyCandidates ? <span className="fs-filter-dot" aria-label="Filters applied" /> : null}</button>
    </div>
    {!onDateChange ? <label className="fs-date"><span className="ez-sr-only">Slate</span><select aria-label="Slate" value={selectedDate} onChange={event => setDate(event.target.value)}>{dates.map(value => <option key={value} value={value}>{new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(new Date(value + "T12:00:00Z"))}</option>)}</select></label> : null}
    {filtersOpen ? <div id="signal-filters" className="fs-filter-panel"><label className="fs-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search teams" placeholder="Search teams" value={query} onChange={event => setQuery(event.target.value)} /></label>{!picksOnly ? <button type="button" className="fs-filter" aria-pressed={onlyCandidates} onClick={() => setOnlyCandidates(value => !value)}>{calibrationPending ? "With signals" : scorePolicy ? "EZPZ only" : `${threshold}+ only`}</button> : null}{query || onlyCandidates ? <button type="button" className="fs-clear-filter" onClick={() => { setQuery(""); setOnlyCandidates(false); }}>Clear filters</button> : null}</div> : null}
    <div className="fs-toolbar"><span aria-live="polite">{needsArchive && !archiveReady ? archiveError ? "Saved slate unavailable" : "Loading saved slate…" : `${groups.length} ${groups.length === 1 ? "game" : "games"}`}</span>
      <label className="fs-sort-select"><span className="ez-sr-only">Sort games</span><select aria-label="Sort games" value={sort === "time" ? "time" : `${sort}:${direction}`} onChange={event => { const [key, order] = event.target.value.split(":"); setSort(key as typeof sort); setDirection(Number(order) || -1); }}><option value="time">Sort: Time</option>{viewSides.some(side => side.comboScore) ? <option value="score:-1">Score: Highest</option> : null}{keys.flatMap(key => [-1, 1].map(order => <option key={`${key}:${order}`} value={`${key}:${order}`}>{META[key].label}: {order < 0 ? "Highest" : "Lowest"}</option>))}</select><ChevronDown size={14} aria-hidden="true" /></label>
    </div>
    <div className="fs-games">{needsArchive && !archiveReady ? <div className="fs-empty" role="status">{archiveError ? <><p>The saved slate could not be loaded.</p><button type="button" className="fs-filter" onClick={() => setArchiveRetry(value => value + 1)}>Try again</button></> : "Loading saved pregame signals…"}</div> : groups.length ? groups.map(rows => <MatchupCard key={`${rows[0].gameKey}-${market}-${selectedDate}`} rows={rows.slice().sort((a, b) => a.market.localeCompare(b.market) || (a.market === "Total" ? (a.side === "Over" ? -1 : 1) : 0))} board={board} picksOnly={picksOnly} report={board.research?.sport === board.sport ? board.research : undefined} date={selectedDate} lineups={needsArchive ? archive?.lineups || [] : lineups} />)
      : <div className="fs-empty">{picksOnly ? calibrationPending ? "Official NCAAM EZPZ Picks are on hold while signal and combination records accumulate." : scorePolicy ? `No qualifying ${board.sport} EZPZ Picks for this view. The highest score must reach ${threshold}, with both markets saved before kickoff.` : `No qualifying ${board.sport} EZPZ Picks for this view. Plays need ${threshold}+ signals and a clear qualifying leader.` : "No games match this view."}</div>}
    </div>
    {picksOnly ? <details className="ep-method"><summary>How plays qualify &amp; how they’re saved</summary>{calibrationPending ? <p>Signal collection and records tracking are active. Official NCAAM selections remain on hold until this sport has its own qualifying threshold.</p> : scorePolicy ? <><p>The highest combo score per game must reach {threshold}, with odds of −150 or better. The score combines the selected side’s exact combination record and the opposing combination’s weakness, keeping favorites, underdogs, overs and unders separate. Small samples are adjusted toward neutral.</p><p>Both markets must be captured before the final decision. The original score inputs, signals and line are saved. Score ties prefer the spread, then a fixed selection order. Scores are historical rankings, not win probabilities. Official score records begin Nov 1.</p></> : <><p>Qualifying signal tests need {threshold}+ signals across at least two evidence sources, odds of −150 or better, and one clear leader per game. Tied leaders wait.</p><p>Live previews update before the final snapshot. Saved tests keep their pregame lines, signals and results. Historical tests are evaluated under the current threshold; they were not necessarily published EZPZ picks.</p></>}</details>
      : null}
  </section>;
}

export function SignalResearch({ board }: { board?: FootballSignalsBoard }) {
  const [market, setMarket] = useState<"Spread" | "Total">("Spread");
  if (!board) return null;
  const resultPolicy = comboPickPolicy(board.sport, board.today);
  const calibrationPending = board.sport === "NCAAM" && !resultPolicy;
  const liveNba = board.sport === "NBA" || board.sport === "NCAAM";
  return <section className="fs-board fs-records-research" aria-label={`${board.sport} Signal Research`}>
    <h2>Signal Research</h2>
    <details className="fs-results"><summary>{calibrationPending ? "EZPZ qualification pending calibration" : resultPolicy ? `Score ${resultPolicy.threshold}+ EZPZ results` : `${signalPickThreshold(board.sport)}+ signal test results`} <strong>{board.summary.record}</strong><span>{board.summary.settled} settled · {board.summary.pending} pending</span></summary>
      <Lines items={[["Win rate", percent(board.summary.winPct)], ["Net units", format(board.summary.netUnits, true)], ["ROI", percent(board.summary.roiPct)], ["Mode", calibrationPending ? "Collecting NCAAM combination history; official threshold pending" : resultPolicy ? "Official score selections from Nov 1; original score inputs retained" : "Saved pregame tests evaluated at the current EZPZ threshold"]]} />
      {board.breakdowns.length ? <table className="fs-table"><thead><tr><th scope="col">Group</th><th scope="col">Record / sample</th><th scope="col">ROI</th></tr></thead><tbody>{board.breakdowns.map(row => <tr key={`${row.dimension}-${row.label}`}><th scope="row">{row.label}<small>{row.dimension}</small></th><td data-label="Record / sample">{row.record.record}<small>{row.record.settled} settled · {row.record.pending} pending</small></td><td data-label="ROI">{percent(row.record.roiPct)}</td></tr>)}</tbody></table> : <p>{liveNba ? "Results appear after qualifying selections are saved before tipoff and settled." : "Results appear after qualifying test selections are saved before kickoff and settled."}</p>}
      {board.history.length ? <table className="fs-table"><thead><tr><th scope="col">{liveNba ? "Saved signal play" : "Saved test play"}</th><th scope="col">{resultPolicy ? "Score" : "Signals"}</th><th scope="col">Result</th></tr></thead><tbody>{board.history.map((row, i) => <tr key={`${row.date}-${row.selection}-${i}`}><th scope="row">{row.selection}<small>{row.game} · {row.date}</small></th><td data-label={resultPolicy ? "Score" : "Signals"}>{row.score != null && resultPolicy ? format(row.score) : row.signalCount}<small>{row.combination || "No active signals"}</small></td><td data-label="Result">{row.result || "Pending"}</td></tr>)}</tbody></table> : null}
      <p>{liveNba ? "All signal observations are saved. Each settled qualifying selection risks one unit at its saved odds. Official selections appear on EZPZ Picks." : "All signal observations are saved, including games that produce no test selection. Each settled test selection risks one unit at its saved odds."}</p>
    </details>
    <div className="fs-markets" role="group" aria-label="Research market">{(["Spread", "Total"] as const).map(value => <button type="button" key={value} aria-pressed={market === value} onClick={() => setMarket(value)}>{value === "Spread" ? "Spreads" : "Totals"}</button>)}</div>
    <CombinationResearch report={board.research} market={market} />
  </section>;
}
