"use client";

import { useEffect, useState } from "react";

type ManualPick = {
  pickId: string; sport: string; date: string; game: string; gameTime: string;
  market: string; selection: string; odds: number | null; oddsBasis: string;
  pickCategory: "manual"; pickLabel: "EZPZ PICK"; approvedAt: string;
};
function formattedTime(value: string) {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(time) : value;
}

export default function ManualEzpzPicks({ sport, date }: { sport: string; date: string }) {
  const [selectedDate, setSelectedDate] = useState(date);
  const [state, setState] = useState<{ loading: boolean; error: string; picks: ManualPick[] }>({
    loading: true, error: "", picks: [],
  });
  useEffect(() => { setSelectedDate(date); }, [date, sport]);
  useEffect(() => {
    if (!selectedDate) return;
    const controller = new AbortController();
    setState({ loading: true, error: "", picks: [] });
    fetch(`/api/official-picks?sport=${encodeURIComponent(sport)}&date=${encodeURIComponent(selectedDate)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.ok || !Array.isArray(data.picks)) throw new Error("Approved picks could not be loaded.");
        if (!controller.signal.aborted) setState({ loading: false, error: "", picks: data.picks });
      }).catch(() => { if (!controller.signal.aborted) setState({ loading: false, error: "The official pick ledger is unavailable. Please try again.", picks: [] }); });
    return () => controller.abort();
  }, [sport, selectedDate]);
  return <section className="fs-board ep-board" aria-label={`${sport} manually approved EZPZ Picks`}>
    <div className="fs-heading"><h2>{sport} EZPZ Picks</h2></div>
    <p className="fs-notice">Official picks are selected manually after ChatGPT and Muse research is compared. Model grades, signal matches, and situation rules are research only; none automatically become an EZPZ Pick.</p>
    <div className="fs-controls">
      <label className="fs-date">Game date <input aria-label="EZPZ game date" type="date" min="2026-11-12" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></label>
      <span className="countPill">{state.picks.length} official {state.picks.length === 1 ? "pick" : "picks"}</span>
    </div>
    <div className="fs-games">
      {state.loading ? <div className="fs-empty" role="status">Loading approved picks…</div> :
       state.error ? <div className="fs-empty" role="alert">{state.error}</div> :
       state.picks.length ? state.picks.map(pick => <article className="fs-game fs-official-pick" key={pick.pickId}>
        <div className="fs-game-status"><span>Manually approved</span><span className="fs-pick-label">EZPZ PICK</span></div>
        <div className="fs-selection"><strong>{pick.selection}</strong></div>
        <p>{pick.game}</p>
        <p>{formattedTime(pick.gameTime)} · {pick.market}</p>
        {pick.odds !== null ? <p>{pick.odds > 0 ? "+" : ""}{pick.odds} {pick.oddsBasis === "assumed" ? "(assumed)" : ""}</p> : null}
       </article>) :
       <div className="fs-empty">No manually approved EZPZ Picks for {sport} on {selectedDate}. Research recommendations and signal-qualified plays are not official picks.</div>}
    </div>
    <details className="ep-method"><summary>How EZPZ Picks are selected</summary><p>ChatGPT researches independently and Muse researches separately. After both lists are compared, only explicitly chosen wagers are saved as official picks. The exact selection and original line are kept; posts to X go through Buffer only for these approved wagers. Historical model/signal records stay separate.</p></details>
  </section>;
}
