"use client";
import type { ReactNode } from "react";
import CompactMatchup, { type CompactMarket } from "./CompactMatchup";
import { ncaamProjectionAdjustments } from "../lib/ncaamProjectionAdjustments";
import type { ncaamReversedTotalView } from "../lib/ncaamTotalDisplay";
import { projectionAdjustments } from "../lib/marketProjectionPolicy";
type Forecast = { away_score: number; home_score: number; spread_pick?: string; total_pick?: string; home_spread_edge: number | null; total_edge: number | null };
export default function NcaamMobileMatchup({ game, forecast, sport = "NCAAM", markets, modelPlays = false, totalView, spreadProjection, children }: {
 game: Record<string,string>; forecast?: Forecast; sport?: "NBA" | "NCAAM"; markets?: CompactMarket[]; modelPlays?: boolean; spreadProjection?: {projection:string;adjustment?:number}; totalView?: ReturnType<typeof ncaamReversedTotalView>; children: ReactNode;
}) {
 const final = game.Completed === "TRUE" || game.Status === "STATUS_FINAL";
 const adjustments = sport === "NCAAM" ? totalView?.adjustments ?? ncaamProjectionAdjustments(forecast) : projectionAdjustments(forecast);
 const rows = markets || (forecast ? [{ name: "Spread", ...spreadProjection, selection: forecast.spread_pick || "No market line", detail: forecast.home_spread_edge == null ? "Edge unavailable" : `${Math.abs(forecast.home_spread_edge).toFixed(1)} pt edge` }, { name: "Total", selection: totalView?.pick ?? (forecast.total_pick || "No market line"), detail: totalView ? `${Math.abs(totalView.edge).toFixed(1)} pt edge` : forecast.total_edge == null ? "Edge unavailable" : `${Math.abs(forecast.total_edge).toFixed(1)} pt edge`, ...(totalView ? { projection: totalView.total.toFixed(1), adjustment: totalView.adjustments.total } : {}) }] : []);
 const stamp = Date.parse(game["Game Time"]);
 return <CompactMatchup id={game["Game ID"] || `${sport}-${game["Away Team"]}-${game["Home Team"]}`} sport={sport} away={game["Away Team"]} home={game["Home Team"]}
  awayScore={totalView?.awayScore ?? forecast?.away_score} homeScore={totalView?.homeScore ?? forecast?.home_score} awayAdjustment={adjustments?.awayScore} homeAdjustment={adjustments?.homeScore}
  time={sport !== "NCAAM" || modelPlays ? Number.isFinite(stamp) ? new Date(stamp).toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit"})+" ET" : "Time unavailable" : undefined}
  status={`${final ? "Final" : !forecast ? "Pending" : "Preview"}${game.Status === "STATUS_IN_PROGRESS" ? " · In progress" : ""}`}
  markets={rows} finalScore={final ? {away:game["Away Score"] || "—", home:game["Home Score"] || "—"} : undefined} returnLabel={modelPlays ? "Back to Model Plays" : "Back to slate"}>{children}</CompactMatchup>;
}
