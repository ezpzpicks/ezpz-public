"use client";

import { useState } from "react";
import SelectionTrial from "../SelectionTrial";
import { SiteHeader } from "../SiteNavigation";
import { trialDate, type TrialSport } from "../../lib/selectionTrial";

export default function SelectionTrialPage() {
  const [sport, setSport] = useState<TrialSport>("NBA"), [refresh, setRefresh] = useState(0);
  const today = trialDate(Date.now()), [date, setDate] = useState(today);
  const dates = Array.from({ length: 14 }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) - i * 86400000).toISOString().slice(0, 10));
  return <main className="fs-board" style={{ maxWidth: 900, margin: "0 auto", padding: "12px 16px" }}>
    <SiteHeader sport={sport} onSportChange={setSport} dates={dates} date={date} onDateChange={setDate}
      refreshing={false} onRefresh={() => setRefresh(n => n + 1)} />
    <p><a href="/">← Back to EZPZ Picks</a></p>
    <h2>Selection trial</h2>
    <p>Compare a new expected-value selector with the current rules. Each sport learns from its own pregame history. Trial results stay separate from official EZPZ records.</p>
    <SelectionTrial key={`${sport}|${date}|${refresh}`} sport={sport} date={date} initiallyOpen />
  </main>;
}
