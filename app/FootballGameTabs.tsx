"use client";

import { useEffect, useMemo, useState } from "react";
import { MatchupWithLogos, SelectionWithTeamLogo, TeamLogoName } from "./TeamLogoName";
import FootballModelFormBadges from "./FootballModelFormBadges";

type Sport = "NFL" | "NCAAF";
type Tab = "Today’s Model Plays" | "Full Slate";
type SheetRow = Record<string, string>;
type FormStatus = "HOT" | "COLD" | "NEUTRAL" | "SAMPLE";

type Play = {
  playType?: string;
  game?: string;
  play?: string;
  oddsLine?: string;
  marketOdds?: string;
  score?: string | number;
  awayTeam?: string;
  homeTeam?: string;
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

type Split = {
  game?: string;
  awayTeam?: string;
  homeTeam?: string;
  market?: "Spread" | "Total";
  selection?: string;
  selectionTeam?: string;
  side?: "Over" | "Under" | "";
  line?: number | null;
  odds?: string;
  betsPct?: number;
  moneyPct?: number;
  warning?: string;
};

type FootballData = {
  today?: string;
  lastUpdated?: string;
  bestPlays?: Play[];
  slateToday?: SheetRow[];
  betTrackerRows?: SheetRow[];
  draftKings?: { status?: string; splits?: Split[] };
};

type WeeklyData = {
  ok?: boolean;
  games?: SheetRow[];
  splits?: Split[];
};

const NFL_ALIASES: Record<string, string[]> = {
  ari: ["ARI", "Arizona Cardinals", "Cardinals", "Arizona"],
  atl: ["ATL", "Atlanta Falcons", "Falcons", "Atlanta"],
  bal: ["BAL", "Baltimore Ravens", "Ravens", "Baltimore"],
  buf: ["BUF", "Buffalo Bills", "Bills", "Buffalo"],
  car: ["CAR", "Carolina Panthers", "Panthers", "Carolina"],
  chi: ["CHI", "Chicago Bears", "Bears", "Chicago"],
  cin: ["CIN", "Cincinnati Bengals", "Bengals", "Cincinnati"],
  cle: ["CLE", "Cleveland Browns", "Browns", "Cleveland"],
  dal: ["DAL", "Dallas Cowboys", "Cowboys", "Dallas"],
  den: ["DEN", "Denver Broncos", "Broncos", "Denver"],
  det: ["DET", "Detroit Lions", "Lions", "Detroit"],
  gb: ["GB", "Green Bay Packers", "Packers", "Green Bay"],
  hou: ["HOU", "Houston Texans", "Texans", "Houston"],
  ind: ["IND", "Indianapolis Colts", "Colts", "Indianapolis"],
  jax: ["JAX", "Jacksonville Jaguars", "Jaguars", "Jacksonville"],
  kc: ["KC", "Kansas City Chiefs", "Chiefs", "Kansas City"],
  lv: ["LV", "Las Vegas Raiders", "Raiders", "Las Vegas"],
  lac: ["LAC", "Los Angeles Chargers", "LA Chargers", "Chargers"],
  lar: ["LAR", "Los Angeles Rams", "LA Rams", "Rams"],
  mia: ["MIA", "Miami Dolphins", "Dolphins", "Miami"],
  min: ["MIN", "Minnesota Vikings", "Vikings", "Minnesota"],
  ne: ["NE", "New England Patriots", "Patriots", "New England"],
  no: ["NO", "New Orleans Saints", "Saints", "New Orleans"],
  nyg: ["NYG", "New York Giants", "NY Giants", "Giants"],
  nyj: ["NYJ", "New York Jets", "NY Jets", "Jets"],
  phi: ["PHI", "Philadelphia Eagles", "Eagles", "Philadelphia"],
  pit: ["PIT", "Pittsburgh Steelers", "Steelers", "Pittsburgh"],
  sea: ["SEA", "Seattle Seahawks", "Seahawks", "Seattle"],
  sf: ["SF", "San Francisco 49ers", "49ers", "San Francisco"],
  tb: ["TB", "Tampa Bay Buccaneers", "Buccaneers", "Tampa Bay"],
  ten: ["TEN", "Tennessee Titans", "Titans", "Tennessee"],
  wsh: ["WAS", "WSH", "Washington Commanders", "Commanders", "Washington"],
};

const NFL_TEAM_KEY = new Map<string, string>();
for (const [key, aliases] of Object.entries(NFL_ALIASES)) {
  NFL_TEAM_KEY.set(key, key);
  aliases.forEach((alias) => NFL_TEAM_KEY.set(textKey(alias), key));
}

function textKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamKey(value: unknown, sport: Sport) {
  const raw = String(value || "").replace(/\s+[+-]?\d+(?:\.\d+)?\s*$/, "").trim();
  const key = textKey(raw);
  if (!key) return "";
  if (sport === "NFL") return NFL_TEAM_KEY.get(key) || key;
  return key.replace(/\buniversity\b/g, "").replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
}

function sameTeam(a: unknown, b: unknown, sport: Sport) {
  const left = teamKey(a, sport);
  const right = teamKey(b, sport);
  if (!left || !right) return false;
  if (left === right) return true;
  if (sport === "NFL") return false;
  const compactLeft = left.replace(/\s+/g, "");
  const compactRight = right.replace(/\s+/g, "");
  if (compactLeft.includes(compactRight) || compactRight.includes(compactLeft)) return true;
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 2));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap >= Math.min(2, Math.max(1, Math.min(leftTokens.size, rightTokens.size)));
}

function parseGameTeams(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parts = raw.split(/\s+(?:@|at|vs\.?|versus)\s+/i).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? { away: parts[0], home: parts[1] } : null;
}

function rowGame(row: SheetRow) {
  return String(row.Game || row["Game Label"] || `${row["Away Team"] || ""} @ ${row["Home Team"] || ""}`).trim();
}

function rowGameTime(row?: SheetRow | null) {
  if (!row) return "";
  return String(row["Game Time"] || row.Time || row["Start Time"] || row["Game Time ET"] || "").trim();
}

function stableGameId(row: SheetRow) {
  return String(row["Game ID"] || row["Game Key"] || row["Event ID"] || "").trim();
}

function rowTeams(row: SheetRow) {
  const parsed = parseGameTeams(rowGame(row));
  return {
    away: String(row["Away Team"] || parsed?.away || "").trim(),
    home: String(row["Home Team"] || parsed?.home || "").trim(),
  };
}

function rowsSameGame(left: SheetRow, right: SheetRow, sport: Sport) {
  const leftId = stableGameId(left);
  const rightId = stableGameId(right);
  if (leftId && rightId && leftId === rightId) return true;
  const a = rowTeams(left);
  const b = rowTeams(right);
  return Boolean(a.away && a.home && b.away && b.home && sameTeam(a.away, b.away, sport) && sameTeam(a.home, b.home, sport));
}

function playTeams(play: Play) {
  const parsed = parseGameTeams(play.game);
  return {
    away: String(play.awayTeam || parsed?.away || "").trim(),
    home: String(play.homeTeam || parsed?.home || "").trim(),
  };
}

function playMatchesRow(play: Play, row: SheetRow, sport: Sport) {
  const p = playTeams(play);
  const r = rowTeams(row);
  return Boolean(p.away && p.home && r.away && r.home && sameTeam(p.away, r.away, sport) && sameTeam(p.home, r.home, sport));
}

function displayTime(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "TBD";
  const twelve = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s+ET)?$/i);
  if (twelve) return `${Number(twelve[1])}:${twelve[2]} ${twelve[3].toUpperCase()}`;
  const military = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const hour24 = Number(military[1]);
    const suffix = hour24 >= 12 ? "PM" : "AM";
    return `${hour24 % 12 || 12}:${military[2]} ${suffix}`;
  }
  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) return raw;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(stamp));
}

function timeSortValue(value: unknown) {
  const raw = String(value || "").trim();
  const twelve = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (twelve) {
    let hour = Number(twelve[1]) % 12;
    if (twelve[3].toUpperCase() === "PM") hour += 12;
    return hour * 60 + Number(twelve[2]);
  }
  const military = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (military) return Number(military[1]) * 60 + Number(military[2]);
  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) return Number.POSITIVE_INFINITY;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(stamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function whole(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n)) : "—";
}

function oneDecimal(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

function probability(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${(Math.abs(n) <= 1 ? n * 100 : n).toFixed(1)}%`;
}

function projection(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value || "—");
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function badge(status?: FormStatus) {
  if (status === "HOT") return { icon: "🔥", label: "HOT", cls: "hot" };
  if (status === "COLD") return { icon: "❄️", label: "COLD", cls: "cold" };
  if (status === "NEUTRAL") return { icon: "➖", label: "NEUTRAL", cls: "neutral" };
  return { icon: "⚠️", label: "SMALL SAMPLE", cls: "sample" };
}

function odds(play: Play) {
  return String(play.marketOdds || play.oddsLine || "—").trim() || "—";
}

function mergeSlateRows(data: FootballData, weekly: WeeklyData | null, sport: Sport) {
  const rows: SheetRow[] = [];
  const primary = data.slateToday || [];

  const add = (row: SheetRow, allowNew: boolean, overwrite: boolean) => {
    const existingIndex = rows.findIndex((candidate) => rowsSameGame(candidate, row, sport));
    if (existingIndex < 0) {
      if (allowNew) rows.push({ ...row });
      return;
    }

    const merged = { ...rows[existingIndex] };
    for (const [field, value] of Object.entries(row)) {
      if (!String(value ?? "").trim()) continue;
      if (overwrite || !String(merged[field] ?? "").trim()) merged[field] = value;
    }
    rows[existingIndex] = merged;
  };

  for (const row of primary) add(row, true, true);

  for (const row of weekly?.games || []) {
    const date = String(row.Date || row["Game Date"] || "").trim();
    if (data.today && date && date !== data.today) continue;
    add(row, primary.length === 0, false);
  }

  return rows.sort((a, b) => {
    const timeDiff = timeSortValue(rowGameTime(a)) - timeSortValue(rowGameTime(b));
    if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
    return rowGame(a).localeCompare(rowGame(b));
  });
}



function GameSummary({ sport, game, time, count, noun = "plays" }: { sport: Sport; game: string; time: string; count?: number; noun?: string }) {
  return (
    <summary className="fgtSummary">
      <span className="fgtChevron">›</span>
      <span className="fgtSummaryMain">
        <strong><MatchupWithLogos sport={sport} game={game} compact /></strong>
        <small>{displayTime(time)}</small>
      </span>
      {typeof count === "number" ? <span className="fgtCount">{count} {noun}</span> : null}
    </summary>
  );
}



function FullSlateCard({ row, sport }: { row: SheetRow; sport: Sport }) {
  const game = rowGame(row);
  const teams = rowTeams(row);
  const spreadGrade = row["Spread Grade"] || "No Play";
  const totalGrade = row["Total Grade"] || "No Play";

  return (
    <div className="fgtSlateBody">
      <div className="fgtScoreboard">
        <div className="fgtTeamScore">
          <div><span>AWAY</span><strong><TeamLogoName sport={sport} team={teams.away} text={teams.away || "Away"} /></strong></div>
          <b>{whole(row["Projected Away"])}</b>
        </div>
        <div className="fgtTeamScore">
          <div><span>HOME</span><strong><TeamLogoName sport={sport} team={teams.home} text={teams.home || "Home"} /></strong></div>
          <b>{whole(row["Projected Home"])}</b>
        </div>
      </div>

      <div className="fgtMetrics">
        <div><span>Projected margin</span><strong>{oneDecimal(row["Projected Margin"])}</strong></div>
        <div><span>Projected total</span><strong>{oneDecimal(row["Projected Total"])}</strong></div>
        <div><span>Reliability</span><strong>{row.Reliability || "—"}</strong></div>
      </div>

      <div className="fgtMarkets">
        <div className="fgtMarketCard">
          <div><span>SPREAD</span><b>{spreadGrade}</b></div>
          <strong><SelectionWithTeamLogo sport={sport} selection={row["Spread Pick"] || "No model play"} game={game} /></strong>
          <small>Model probability {probability(row["Spread Probability"])}</small>
        </div>
        <div className="fgtMarketCard">
          <div><span>TOTAL</span><b>{totalGrade}</b></div>
          <strong>{row["Total Pick"] || "No model play"}</strong>
          <small>Model probability {probability(row["Total Probability"])}</small>
        </div>
      </div>
    </div>
  );
}

function ModelPlayRow({ play, sport, data }: { play: Play; sport: Sport; data: FootballData }) {
  const isProp = textKey(play.role).includes("player prop");
  const form = play.formStatus ? badge(play.formStatus) : null;
  const sideLine = [play.propSide, play.propLine].filter((value) => String(value ?? "").trim()).join(" ");
  const headshot = String(play.headshotUrl || "").trim();
  const formRecord = String(play.formRecord || "").trim();

  return (
    <article className={`fgtPlayRow ${isProp ? "prop" : "game"} ${play.formStatus === "HOT" ? "hot" : ""}`}>
      <div className="fgtPlayMain">
        {isProp ? (
          <>
            <span className="fgtEyebrow">{play.playType || "PROP"} • {play.propMarket || "Player Prop"}{play.propSide ? ` • ${play.propSide}` : ""}</span>
            <div className="fgtPlayerNameRow">
              {headshot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="fgtHeadshot"
                  src={headshot}
                  alt={`${play.playerName || "Player"} headshot`}
                  loading="lazy"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
              ) : null}
              <strong>{play.playerName || play.play}</strong>
            </div>
            <span className="fgtPropSelection">{sideLine || play.play || "—"}</span>
          </>
        ) : (
          <>
            <span className="fgtEyebrow">{play.playType || play.role || "MODEL PLAY"}</span>
            <strong><SelectionWithTeamLogo sport={sport} selection={play.play || ""} game={play.game || ""} /></strong>
            <small>{play.role || "Game market"}</small>
          </>
        )}
      </div>
      <div className="fgtPlayMetrics">
        {isProp ? <span>PROJ <b>{projection(play.propProjection)}</b></span> : null}
        {isProp ? <span>LINE <b>{String(play.propLine ?? "—")}</b></span> : null}
        <span>MODEL <b>{probability(play.score)}</b></span>
        <span>ODDS <b>{odds(play)}</b></span>
      </div>
      {sport === "NCAAF" && !isProp ? (
        <FootballModelFormBadges
          rows={data.betTrackerRows || []}
          today={data.today}
          grade={play.playType}
          market={play.role || play.playType}
          selection={play.play}
          className="fgtModelFormBadges"
        />
      ) : form ? (
        <div className="fgtFormLine">
          <span className={`fgtBadge ${form.cls}`}>{form.icon} {form.label}</span>
          {formRecord ? <span className="fgtFormRecord">L7 <b>{formRecord}</b></span> : null}
        </div>
      ) : null}
    </article>
  );
}

export default function FootballGameTabs({ sport, tab, data }: { sport: Sport; tab: Tab; data: FootballData }) {
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch(`/api/football-weekly-market?sport=${sport}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (active && result?.ok) setWeekly(result as WeeklyData); })
      .catch(() => undefined);
    return () => { active = false; controller.abort(); };
  }, [sport, data.lastUpdated]);

  const slate = useMemo(() => mergeSlateRows(data, weekly, sport), [data, weekly, sport]);
  const plays = data.bestPlays || [];

  const groups = useMemo(() => {
    const output: { game: string; time: string; row: SheetRow | null; plays: Play[] }[] = [];
    for (const play of plays) {
      const row = slate.find((candidate) => playMatchesRow(play, candidate, sport)) || null;
      const existing = output.find((group) => {
        if (row && group.row) return rowsSameGame(group.row, row, sport);
        const a = playTeams(play);
        const b = parseGameTeams(group.game);
        return Boolean(b && sameTeam(a.away, b.away, sport) && sameTeam(a.home, b.home, sport));
      });
      if (existing) existing.plays.push(play);
      else output.push({ game: row ? rowGame(row) : String(play.game || "Unknown matchup"), time: rowGameTime(row), row, plays: [play] });
    }
    return output.sort((a, b) => timeSortValue(a.time) - timeSortValue(b.time) || a.game.localeCompare(b.game));
  }, [plays, slate, sport]);

  const live = data.draftKings?.status === "LIVE" || Boolean(weekly?.splits?.length);

  return (
    <section className="footballGameTabs">
      <div className="fgtHead">
        <div>
          <h2>{sport === "NFL" ? "NFL" : "College Football"} {tab}</h2>
          <p>{tab === "Full Slate" ? "One matchup tile per game • whole-number score projections" : "Model Plays grouped by matchup so the full Saturday/Sunday board stays easy to scan"}</p>
        </div>
        <div className="fgtHeadBadges"><span>{tab === "Full Slate" ? slate.length : groups.length} games</span><span className={live ? "live" : ""}>{live ? "ScoresAndOdds live" : "ScoresAndOdds pending"}</span></div>
      </div>

      {tab === "Full Slate" ? (
        slate.length ? <div className="fgtStack">{slate.map((row, index) => {
          const game = rowGame(row);
          const time = rowGameTime(row);
          return <details className="fgtGame" key={stableGameId(row) || `${teamKey(rowTeams(row).away, sport)}-${teamKey(rowTeams(row).home, sport)}-${index}`} open={slate.length === 1}>
            <GameSummary sport={sport} game={game} time={time} />
            <FullSlateCard row={row} sport={sport} />
          </details>;
        })}</div> : <div className="fgtEmpty">No {sport} games are posted for {data.today || "today"} yet.</div>
      ) : (
        groups.length ? <div className="fgtStack">{groups.map((group, groupIndex) => <details className="fgtGame fgtModelGame" key={`${teamKey(playTeams(group.plays[0]).away, sport)}-${teamKey(playTeams(group.plays[0]).home, sport)}-${groupIndex}`}>
          <GameSummary sport={sport} game={group.game} time={group.time} count={group.plays.length} noun={group.plays.length === 1 ? "play" : "plays"} />
          <div className="fgtModelBody">{group.plays.map((play, index) => <ModelPlayRow key={`${play.play}-${play.playerName}-${play.propMarket}-${index}`} play={play} sport={sport} data={data} />)}</div>
        </details>)}</div> : <div className="fgtEmpty">No graded {sport} Model Plays are saved for {data.today || "today"}.</div>
      )}

      <style jsx global>{`
        .footballGameTabs{display:grid;gap:18px}.fgtHead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}.fgtHead h2{margin:0 0 5px;font-size:clamp(1.35rem,4vw,2.25rem);letter-spacing:-.04em}.fgtHead p{margin:0;max-width:760px;color:var(--ez-muted);font-size:.82rem;line-height:1.45}.fgtHeadBadges{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.fgtHeadBadges span{border:1px solid var(--ez-border);border-radius:999px;padding:7px 11px;color:var(--ez-muted);font-size:.76rem;font-weight:850}.fgtHeadBadges span.live{color:var(--ez-green);border-color:rgba(43,216,117,.35)}
        .fgtStack{display:grid;gap:12px}.fgtGame{overflow:hidden;border:1px solid rgba(68,151,248,.2);border-radius:22px;background:linear-gradient(145deg,rgba(8,17,31,.94),rgba(4,10,20,.92));box-shadow:0 18px 48px rgba(0,0,0,.28)}.fgtSummary{cursor:pointer;list-style:none;display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:10px;padding:16px 18px;user-select:none}.fgtSummary::-webkit-details-marker{display:none}.fgtChevron{color:#78b9ff;font-size:25px;font-weight:800;line-height:1;transition:transform .18s ease}.fgtGame[open] .fgtChevron{transform:rotate(90deg)}.fgtGame[open] .fgtSummary{border-bottom:1px solid rgba(78,153,241,.13);background:linear-gradient(90deg,rgba(31,110,216,.1),transparent)}.fgtSummaryMain{display:grid;gap:4px;min-width:0}.fgtSummaryMain strong{color:#f7fbff;font-size:16px;line-height:1.25;font-weight:920}.fgtSummaryMain small{color:rgba(151,175,205,.76);font-size:11px;font-weight:700}.fgtCount{border:1px solid rgba(76,163,255,.24);border-radius:999px;padding:7px 10px;background:rgba(32,105,210,.13);color:#d9edff;font-size:10px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
        .fgtSlateBody{display:grid;gap:10px;padding:10px}.fgtScoreboard{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fgtTeamScore{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;border:1px solid rgba(98,139,191,.15);border-radius:16px;padding:13px;background:rgba(7,16,30,.66)}.fgtTeamScore>div{min-width:0}.fgtTeamScore span{display:block;color:var(--ez-muted);font-size:9px;font-weight:900;letter-spacing:.07em}.fgtTeamScore strong{display:block;margin-top:4px;color:#f2f7ff;font-size:15px;overflow-wrap:anywhere}.fgtTeamScore>b{color:#8bc5ff;font-size:32px;line-height:1;letter-spacing:-.04em}.fgtMetrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.fgtMetrics>div{border:1px solid rgba(98,139,191,.14);border-radius:14px;padding:11px 12px;background:rgba(8,17,31,.62)}.fgtMetrics span{display:block;color:var(--ez-muted);font-size:9px}.fgtMetrics strong{display:block;margin-top:4px}.fgtMarkets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fgtMarketCard{min-width:0;border:1px solid rgba(93,137,192,.16);border-radius:16px;padding:12px 13px;background:linear-gradient(145deg,rgba(10,22,40,.72),rgba(6,14,26,.82))}.fgtMarketCard>div{display:flex;align-items:center;justify-content:space-between;gap:8px}.fgtMarketCard>div span{color:#78b9ff;font-size:10px;font-weight:950;letter-spacing:.07em}.fgtMarketCard>div b{border:1px solid rgba(93,137,192,.18);border-radius:999px;padding:4px 7px;color:#cfe6ff;font-size:9px}.fgtMarketCard>strong{display:block;margin-top:9px;color:#f4f8ff;font-size:17px;line-height:1.2;overflow-wrap:anywhere}.fgtMarketCard>small{display:block;margin-top:5px;color:var(--ez-muted);font-size:10px}
        .fgtProps,.fgtDk{border:1px solid rgba(75,132,201,.15);border-radius:16px;padding:12px;background:rgba(5,13,25,.62)}.fgtSectionTitle{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.fgtSectionTitle span{color:#8fc7ff;font-size:9px;font-weight:950;letter-spacing:.08em}.fgtSectionTitle b{display:grid;place-items:center;min-width:24px;height:24px;border-radius:999px;background:rgba(47,140,255,.12);color:#cfe6ff;font-size:10px}.fgtPropStack{display:grid;gap:7px}.fgtPropRow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;border:1px solid rgba(98,139,191,.12);border-radius:13px;padding:9px 10px;background:rgba(8,18,34,.62)}.fgtPropIdentity{display:grid;gap:2px;min-width:0}.fgtPropIdentity strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f3f8ff;font-size:13px}.fgtPropIdentity small{color:var(--ez-muted);font-size:9px}.fgtPropNumbers{display:flex;gap:8px}.fgtPropNumbers span,.fgtPlayMetrics span{display:grid;gap:1px;color:var(--ez-muted);font-size:8px;font-weight:850;letter-spacing:.04em}.fgtPropNumbers b,.fgtPlayMetrics b{color:#eef6ff;font-size:11px}.fgtBadge{display:inline-flex;align-items:center;width:max-content;border:1px solid rgba(112,145,186,.2);border-radius:999px;padding:5px 7px;font-size:8px;font-weight:950;letter-spacing:.025em;white-space:nowrap}.fgtBadge.hot{color:#adf4c7;border-color:rgba(43,216,117,.34);background:rgba(28,130,78,.15)}.fgtBadge.cold{color:#b7d7ff;border-color:rgba(94,167,255,.3);background:rgba(50,108,180,.14)}.fgtBadge.neutral{color:#d4deeb;background:rgba(100,120,146,.12)}.fgtBadge.sample{color:#f7d98d;border-color:rgba(247,200,92,.26);background:rgba(155,115,30,.13)}.fgtDk{display:grid;gap:6px}.fgtDk .fgtSectionTitle{margin-bottom:2px}.fgtDkRow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;color:var(--ez-muted);font-size:10px}.fgtDkRow strong{color:#dcecff}.fgtDkRow span{color:#eef5ff}.fgtDkRow small{white-space:nowrap}
        .fgtModelBody{display:grid;gap:8px;padding:10px}.fgtPlayRow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;border:1px solid rgba(88,137,196,.17);border-radius:16px;padding:12px 13px;background:linear-gradient(145deg,rgba(9,19,35,.78),rgba(5,12,23,.85))}.fgtPlayRow.hot{border-color:rgba(43,216,117,.38);box-shadow:0 0 18px rgba(43,216,117,.07)}.fgtPlayMain{display:grid;gap:3px;min-width:0}.fgtEyebrow{color:#78b9ff;font-size:8px;font-weight:950;letter-spacing:.06em;text-transform:uppercase}.fgtPlayMain>strong{color:#f4f8ff;font-size:15px;overflow-wrap:anywhere}.fgtPlayMain>small{color:var(--ez-muted);font-size:9px}.fgtPlayerNameRow{display:flex;align-items:center;gap:8px;min-width:0}.fgtPlayerNameRow strong{color:#f4f8ff;font-size:15px;overflow-wrap:anywhere}.fgtHeadshot{width:36px;height:36px;border-radius:50%;object-fit:cover;object-position:center top;border:1px solid rgba(98,164,239,.28);background:rgba(28,57,91,.2);flex:0 0 auto}.fgtPropSelection{color:#f1f7ff;font-size:14px;font-weight:900;line-height:1.25}.fgtFormLine{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.fgtModelFormBadges{grid-column:1/-1}.fgtFormRecord{display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(112,145,186,.18);border-radius:999px;padding:5px 7px;color:var(--ez-muted);font-size:8px;font-weight:900;white-space:nowrap}.fgtFormRecord b{color:#eef6ff;font-size:9px}.fgtPlayMetrics{display:flex;gap:10px}.fgtEmpty{border:1px solid var(--ez-border);border-radius:22px;padding:30px;text-align:center;color:var(--ez-muted);background:linear-gradient(145deg,var(--ez-panel),var(--ez-panel-2))}
        @media(max-width:700px){.fgtHead{align-items:flex-start;flex-direction:column}.fgtHeadBadges{justify-content:flex-start}.fgtSummary{padding:14px 15px}.fgtScoreboard,.fgtMarkets{grid-template-columns:1fr}.fgtMetrics{grid-template-columns:1fr}.fgtPropRow,.fgtPlayRow{grid-template-columns:minmax(0,1fr) auto}.fgtPropRow>.fgtBadge,.fgtPlayRow>.fgtFormLine{grid-column:1/-1}.fgtPropNumbers,.fgtPlayMetrics{justify-content:flex-end}.fgtDkRow{grid-template-columns:auto minmax(0,1fr)}.fgtDkRow small{grid-column:1/-1}.fgtCount{font-size:9px;padding:6px 8px}}
      `}</style>
    </section>
  );
}
