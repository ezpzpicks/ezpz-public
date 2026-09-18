import PublicBoardClient from "./PublicBoardClient";
import {
  readEzpzCurrentPicks,
  type EzpzCurrentSport,
} from "../lib/ezpzCurrentPicks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SPORTS: EzpzCurrentSport[] = ["MLB", "NFL", "NCAAF"];
const MAX_SNAPSHOT_AGE_MS = 20 * 60_000;

type AnyRow = Record<string, any>;

function firstValue(...values: unknown[]) {
  for (const value of values) {
    if (value === 0) return 0;
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function todayET() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function inferredLine(value: unknown) {
  const text = String(value || "").trim().replace(/[−–—]/g, "-");
  const matches = text.match(/[+-]?\\d+(?:\\.\\d+)?/g) || [];
  if (!matches.length) return "";
  const parsed = Number(matches[matches.length - 1]);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 100) return "";
  return String(parsed);
}

function normalizePick(pick: AnyRow) {
  const selection = String(firstValue(pick.selection, pick.Selection, pick.play, pick.Play));
  const play = String(firstValue(pick.play, pick.Play, selection));
  return {
    game: String(firstValue(pick.game, pick.Game)),
    market: String(firstValue(pick.market, pick.Market, pick.propMarket, pick["Prop Market"])),
    selection,
    play,
    line: String(firstValue(
      pick.line,
      pick.Line,
      pick.propLine,
      pick["Prop Line"],
      pick.altLine,
      inferredLine(selection || play),
    )),
    odds: String(firstValue(pick.odds, pick.Odds, pick.americanOdds, pick["American Odds"], pick.altOdds)),
    source: String(firstValue(pick.source, pick.Source)),
    bestPlayType: String(firstValue(pick.bestPlayType, pick["Best Play Type"])),
    grade: String(firstValue(pick.grade, pick.playGrade, pick.bestPlayGrade, pick.Grade)),
    tier: String(firstValue(pick.trendTier, pick.v2Tier, pick.tier, pick.Tier)),
    label: String(firstValue(pick.snapshotStatus, pick.status, pick.Status)),
    snapshotStatus: String(firstValue(pick.snapshotStatus, pick["Snapshot Status"])),
  };
}

const crawlerOnlyStyle = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

export default async function Home() {
  const date = todayET();
  const rows = await Promise.all(
    SPORTS.map(async (sport) => ({
      sport,
      snapshot: await readEzpzCurrentPicks(sport),
    })),
  );

  return (
    <>
      <section
        id="ezpz-live-pick-feed"
        aria-label="EZPZ live pick feed"
        style={crawlerOnlyStyle}
      >
        <h2>EZPZ_LIVE_PICK_FEED</h2>
        <p>DATE_ET: {date}</p>
        <p>DATA_SOURCE: persisted-cron-snapshot</p>
        {rows.map(({ sport, snapshot }) => {
          const updatedAtMs = snapshot ? Date.parse(snapshot.updatedAt) : Number.NaN;
          const ageMs = Number.isFinite(updatedAtMs)
            ? Date.now() - updatedAtMs
            : Number.POSITIVE_INFINITY;
          const stale =
            !snapshot ||
            snapshot.date !== date ||
            ageMs > MAX_SNAPSHOT_AGE_MS;
          const picks = snapshot?.picks.map(normalizePick) || [];

          return (
            <div key={sport}>
              <h3>SPORT: {sport}</h3>
              <p>STATUS: {stale ? "UNVERIFIED" : "OK"}</p>
              <p>SNAPSHOT_DATE: {snapshot?.date || ""}</p>
              <p>SNAPSHOT_UPDATED_AT: {snapshot?.updatedAt || ""}</p>
              <p>
                SNAPSHOT_AGE_SECONDS:{" "}
                {Number.isFinite(ageMs)
                  ? Math.max(0, Math.round(ageMs / 1000))
                  : ""}
              </p>
              <p>PICK_COUNT: {stale ? "UNVERIFIED" : picks.length}</p>
              {!stale && picks.length === 0 ? <p>NO_CURRENT_PICKS</p> : null}
              {!stale
                ? picks.map((pick, index) => (
                    <p key={`${sport}-${index}`}>
                      PICK {index + 1}: GAME={pick.game} | MARKET={pick.market} |
                      SELECTION={pick.selection || pick.play} | LINE={pick.line} |
                      ODDS={pick.odds} | GRADE={pick.grade} | TIER={pick.tier} |
                      BEST_PLAY_TYPE={pick.bestPlayType} | SOURCE={pick.source} |
                      LABEL={pick.label} | SNAPSHOT_STATUS={pick.snapshotStatus}
                    </p>
                  ))
                : null}
            </div>
          );
        })}
      </section>
      <PublicBoardClient />
    </>
  );
}
