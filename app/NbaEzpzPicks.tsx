"use client";

import FootballSignals from "./FootballSignalsBoard";
import type { NbaMarketPayload } from "./NbaBoard";

export default function NbaEzpzPicks({ data }: { data: NbaMarketPayload }) {
  return <FootballSignals board={data.signals} picksOnly sport="NBA" />;
}
