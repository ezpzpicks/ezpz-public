"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { DirectTrendRecords, FootballTrendMarketBoard } from "./FootballTrendMarketBoard";
import type { NbaMarketPayload } from "./NbaBoard";

type Groups = ComponentProps<typeof FootballTrendMarketBoard>["groups"];
export default function NbaPublicSplits({ data }: { data: NbaMarketPayload }) {
  const currentDate = data.date || data.games[0]?.Date || "";
  const [selectedDate, setSelectedDate] = useState(currentDate), [retry, setRetry] = useState(0);
  const [archive, setArchive] = useState<{ date: string; data?: NbaMarketPayload; error?: boolean } | null>(null);
  const dates = [...new Set([currentDate, ...(data.availableDates || [])])].filter(Boolean).sort();
  const date = dates.includes(selectedDate) ? selectedDate : currentDate;
  const needsArchive = date !== currentDate;
  useEffect(() => {
    if (!needsArchive) return;
    const controller = new AbortController();
    setArchive({ date });
    async function load() {
      try {
        const response = await fetch(`/api/nba-public-data?date=${date}`, { signal: controller.signal });
        const value = await response.json();
        if (!response.ok || !value.ok || value.today !== date || !value.nbaMarket) throw new Error("Saved markets unavailable");
        if (!controller.signal.aborted) setArchive({ date, data: value.nbaMarket });
      } catch { if (!controller.signal.aborted) setArchive({ date, error: true }); }
    }
    void load();
    return () => controller.abort();
  }, [date, needsArchive, retry]);
  const view = needsArchive ? archive?.date === date ? archive.data : undefined : data;
  const groups = useMemo(() => {
    const grouped = new Map<string, Groups[number]>();
    for (const play of (view?.trendPlays || []) as Groups[number]["plays"]) {
      const group = grouped.get(play.gameKey) || { game: play.game, plays: [] };
      group.plays.push(play); grouped.set(play.gameKey, group);
    }
    return [...grouped.values()];
  }, [view?.trendPlays]);
  return <section className="footballBoard" aria-label="NBA Public Betting Splits">
    <div className="trendTabHeader">
      <details className="betTrendGlossary"><summary><span>Bet Trend Glossary</span><small>View signal definitions</small></summary>
        <div className="directTrendRules betTrendGlossaryBody">
          <span><b>Public Fade</b> Take the opposite side when the public side has more than 75% of bets and at least a 55-point Bets/Money gap.</span>
          <span><b>RLM</b> Public bets rise 5+ points while the spread or total moves 1.5+ points against that side.</span>
          <span><b>Sharp</b> Money share exceeds bet share by 25+ points.</span>
          <span><b>Market Move</b> Follow a total when the total moves 1.0+ point in that direction, with at least one hour of tracked history.</span>
          <span><b>Money Momentum</b> Money share rises 10+ points while the spread or total moves 0.5+ point toward that side, with at least one hour of tracked history.</span>
          <span><b>Total Drop Fade</b> Take the Over when the game total drops at least 1.5 points from its opening line.</span>
          <span><b>Ranked trends</b> Only NBA’s top 20 eligible Wilson-ranked trends receive badges or contribute the public-trend signal. Multiple matches count once.</span>
        </div>
      </details>
      <div className="trendGamesCountRow"><span className="countPill">{groups.length} games</span></div>
      <div className="trendWeekControls simplifiedTrendControls"><label><span>View market slate</span>
        <select aria-label="View NBA market slate" value={date} onChange={event => setSelectedDate(event.target.value)} disabled={!dates.length}>
          {dates.map(day => <option key={day} value={day}>{new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(new Date(day + "T12:00:00Z"))}</option>)}
        </select></label></div>
    </div>
    {!view ? <div className="empty footballEmpty" role={archive?.error ? "alert" : "status"}>{archive?.error
      ? <>The saved NBA slate could not be loaded. <button type="button" className="refreshBtn" onClick={() => setRetry(value => value + 1)}>Try again</button></>
      : "Loading saved NBA markets…"}</div> : <>
      {view.stale ? <p className="fs-notice" role="status">The latest live market observation is delayed. Saved lines remain visible; signals await fresh data.</p> : null}
      {groups.length ? <FootballTrendMarketBoard groups={groups} sport="NBA" nbaLeaderboard={view.leaderboard || []} />
        : <div className="empty footballEmpty">No NBA ScoresAndOdds Spread/Total markets are stored for this slate yet.</div>}
      <div className="directTrendRecordWrap"><DirectTrendRecords rows={[]} sport="NBA" nbaLeaderboard={view.leaderboard || []} /></div>
    </>}
  </section>;
}
