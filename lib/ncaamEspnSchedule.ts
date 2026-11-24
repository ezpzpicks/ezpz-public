import { ncaamDate, normalizeNcaamSlate, type NcaamGame } from "./ncaamMarketCore";

export const shiftNcaamScheduleDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** ESPN groups some post-midnight Eastern games with the preceding broadcaster slate. */
export function bucketNcaamEspnSchedule(payload: any, providerDate: string): Map<string, NcaamGame[]> {
  if (!Array.isArray(payload?.events)) throw new Error("ESPN NCAAM slate is missing events.");
  const allowed = new Set([-1, 0, 1].map(offset => shiftNcaamScheduleDate(providerDate, offset)));
  const events = new Map<string, any[]>();
  const ids = new Set<string>();
  for (const event of payload.events) {
    if (![2, 3].includes(Number(event?.season?.type))) continue;
    const stamp = Date.parse(event.competitions?.[0]?.date || event.date || "");
    if (!Number.isFinite(stamp)) throw new Error("NCAAM schedule identity or Eastern date is invalid.");
    const date = ncaamDate(stamp), id = String(event.id);
    if (!allowed.has(date)) throw new Error("NCAAM ESPN event is outside its adjacent Eastern slate.");
    if (ids.has(id)) throw new Error("Duplicate NCAAM games.");
    ids.add(id);
    events.set(date, [...(events.get(date) || []), event]);
  }
  // Reuse the existing strict competition, identity, D1, and score validation.
  return new Map([...events].map(([date, grouped]) => [date, normalizeNcaamSlate({ events: grouped }, date)]));
}

export function mergeNcaamEspnGames(previous: NcaamGame[], current: NcaamGame[]): NcaamGame[] {
  const merged = new Map(previous.map(game => [game.gameId, game]));
  for (const game of current) {
    const old = merged.get(game.gameId);
    if (old && (game.date !== old.date || Date.parse(game.tipoff) !== Date.parse(old.tipoff)
      || game.awayId !== old.awayId || game.homeId !== old.homeId || game.season !== old.season
      || (old.completed && game.completed && (old.awayScore !== game.awayScore || old.homeScore !== game.homeScore)))) {
      throw new Error(`Conflicting NCAAM ESPN game identity or final score: ${game.gameId}.`);
    }
    // A stale adjacent copy must not replace a validated final.
    if (!old?.completed || game.completed) merged.set(game.gameId, game);
  }
  return [...merged.values()].sort((a, b) => Date.parse(a.tipoff) - Date.parse(b.tipoff));
}

/** Per-collection cache prevents re-fetching the same provider day during settlement. */
export function createNcaamEspnScheduleReader(fetcher = fetch) {
  const requests = new Map<string, Promise<Map<string, NcaamGame[]>>>();
  function provider(date: string) {
    if (!requests.has(date)) requests.set(date, (async () => {
      const response = await fetcher(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date.replaceAll("-", "")}&groups=50&limit=1000`,
        { cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`ESPN NCAAM schedule request failed for ${date}: ${response.status}`);
      return bucketNcaamEspnSchedule(await response.json(), date);
    })());
    return requests.get(date)!;
  }
  return async (date: string) => {
    const day = provider(date), priorDate = shiftNcaamScheduleDate(date, -1);
    const previousDay = provider(priorDate).then(value => ({ value, warning: "" }), error => ({
      value: null, warning: `Adjacent ESPN NCAAM schedule ${priorDate} unavailable: ${error instanceof Error ? error.message : String(error)}`,
    }));
    const [current, adjacent] = await Promise.all([day, previousDay]);
    const following = current.get(shiftNcaamScheduleDate(date, 1)) || [];
    // An ID we will write must not also claim a different date, but a conflict
    // confined to yesterday's unrelated coverage cannot block today's slate.
    if (adjacent.value) {
      const relevantIds = new Set([...(adjacent.value.get(date) || []), ...(current.get(date) || []),
        ...following].map(game => game.gameId));
      mergeNcaamEspnGames([...adjacent.value.values()].flat().filter(game => relevantIds.has(game.gameId)),
        [...current.values()].flat().filter(game => relevantIds.has(game.gameId)));
    }
    return {
      games: mergeNcaamEspnGames(adjacent.value?.get(date) || [], current.get(date) || []),
      following,
      warning: adjacent.warning,
    };
  };
}

export type NcaamEspnScheduleReader = ReturnType<typeof createNcaamEspnScheduleReader>;
