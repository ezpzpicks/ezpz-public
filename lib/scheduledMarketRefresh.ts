import { readTursoDataset, readTursoDatasetByDateKeys, replaceTursoDataset, type TursoSport } from "./tursoStore";
import { parseGameStart, isoDate } from "./mlbTrendV2";
import { nflKickoffIso } from "./footballWeeklyMarket";
import { marketRefreshDecision } from "./marketRefreshPolicy";

type Sport = Extract<TursoSport, "MLB" | "NFL" | "NCAAF">;
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
    const date = isoDate(row.Date), time = String(row["Game Time"] || row["Game Time ET"] || row.Time || "");
    const kickoff = sport === "MLB" ? parseGameStart(date, time) : Date.parse(nflKickoffIso(date, time));
    const final = /final|cancel|postpon/i.test(String(row.Status || row["Game Status"] || ""));
    const live = /in.?progress|live|halftime|delay|suspend/i.test(String(row.Status || row["Game Status"] || ""));
    return { date, kickoff: kickoff != null && Number.isFinite(kickoff) ? kickoff : null, final, live };
  });
  const last = Date.parse(String(state[0]?.["Updated At"] || ""));
  const lastSuccess = Number.isFinite(last) ? last : null;
  const decision = marketRefreshDecision(games, today, now, lastSuccess, stage === "public");
  console.info("[market-refresh]", JSON.stringify({ sport, stage, action: decision.due ? "collect" : "skip",
    checkedAt: new Date(now).toISOString(), lastSuccess: lastSuccess == null ? null : new Date(lastSuccess).toISOString(), ...decision }));
  return decision;
}

export async function recordScheduledMarketRefresh(sport: Sport, stage: Stage, startedAt: number) {
  // Record only successful work. A failed collection remains due on the next
  // five-minute cron tick, including after a cold start or deployment.
  await replaceTursoDataset(sport, stateDataset(stage), [{ Date: day(startedAt), "Updated At": new Date(startedAt).toISOString() }]);
  console.info("[market-refresh]", JSON.stringify({ sport, stage, action: "saved", lastSuccess: new Date(startedAt).toISOString() }));
}
