import { readTursoDataset, readTursoDatasetByDateKeys, replaceTursoDataset, type TursoSport } from "./tursoStore";
import { parseGameStart, isoDate } from "./mlbTrendV2";
import { nflKickoffIso } from "./footballWeeklyMarket";
import { marketRefreshDecision } from "./marketRefreshPolicy";

type Sport = Extract<TursoSport, "MLB" | "NFL" | "NCAAF" | "NBA">;
type Stage = "market" | "public";
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (now: number) => dateFormatter.format(new Date(now));
const stateDataset = (stage: Stage) => `refresh_state_${stage}`;

export async function scheduledMarketRefresh(sport: Sport, stage: Stage, now = Date.now()) {
  const today = day(now), dates = [-1, 0, 1].flatMap(offset => {
    const date=day(now + offset * 86_400_000), [year,month,dateOfMonth]=date.split("-");
    return [date, `${month}/${dateOfMonth}/${year}`, `${Number(month)}/${Number(dateOfMonth)}/${year}`];
  });
  const [state, schedule, slate] = await Promise.all([
    readTursoDataset(sport, stateDataset(stage)),
    readTursoDatasetByDateKeys(sport, sport === "MLB" ? "daily_slate" : "schedule", dates),
    sport === "MLB" ? Promise.resolve([]) : readTursoDatasetByDateKeys(sport, "posted_games", dates),
  ]);
  const games = [...schedule, ...slate].map(row => {
    const date = isoDate(row.Date || row["Game Date"]), time = String(row["Game Time"] || row["Game Time ET"] || row.Time || "");
    const kickoff = sport === "MLB" ? parseGameStart(date, time)
      : sport === "NBA" ? Date.parse(time) : Date.parse(nflKickoffIso(date, time));
    const final = /final|cancel|postpon/i.test(String(row.Status || row["Game Status"] || ""))
      || /^(true|yes|1)$/i.test(String(row.Completed || ""));
    const live = /in.?progress|live|halftime|delay|suspend/i.test(String(row.Status || row["Game Status"] || ""));
    return { date, kickoff: kickoff != null && Number.isFinite(kickoff) ? kickoff : null, final, live };
  });
  const last = Date.parse(String(state[0]?.["Updated At"] || ""));
  const lastSuccess = Number.isFinite(last) ? last : null;
  const attempt = Date.parse(String(state[0]?.["Last Attempt At"] || ""));
  const lastAttempt = Number.isFinite(attempt) ? Math.max(attempt, lastSuccess || 0) : lastSuccess;
  const decision = marketRefreshDecision(games, today, now, lastAttempt, stage === "public");
  // Public pick snapshots are tied to the Eastern game date. Refresh on the
  // first tick of a new day even when yesterday's collection is still recent.
  if ((stage === "public" || sport === "NBA") && lastAttempt != null && day(lastAttempt) !== today) {
    decision.due = true;
    decision.reason = "New game date";
  }
  // Persist the attempt before fetching. Failures and partial feeds follow the
  // same 30m/5m policy across cold starts, without advancing data freshness.
  if (decision.due) await replaceTursoDataset(sport, stateDataset(stage), [{
    ...state[0], Date: today, "Last Attempt At": new Date(now).toISOString(),
  }]);
  console.info("[market-refresh]", JSON.stringify({ sport, stage, action: decision.due ? "collect" : "skip",
    checkedAt: new Date(now).toISOString(), lastAttempt: lastAttempt == null ? null : new Date(lastAttempt).toISOString(),
    lastSuccess: lastSuccess == null ? null : new Date(lastSuccess).toISOString(), ...decision }));
  return { ...decision, lastSuccess: lastSuccess == null ? null : new Date(lastSuccess).toISOString() };
}

export async function recordScheduledMarketRefresh(sport: Sport, stage: Stage, startedAt: number) {
  const state = await readTursoDataset(sport, stateDataset(stage));
  // Success remains a separate clock: an attempted or retained refresh is
  // never evidence of fresh market data.
  const latest = Math.max(startedAt, Date.parse(state[0]?.["Updated At"] || "") || 0);
  await replaceTursoDataset(sport, stateDataset(stage), [{ ...state[0], Date: day(latest),
    "Updated At": new Date(latest).toISOString() }]);
  console.info("[market-refresh]", JSON.stringify({ sport, stage, action: "saved", lastSuccess: new Date(startedAt).toISOString() }));
}
