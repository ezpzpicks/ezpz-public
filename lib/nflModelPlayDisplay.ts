import type { NflPendingGame } from "./nflPendingGames";
import { upcomingNflProps, type NflPlayerProp } from "./nflPlayerProps";
import { nflTrendGameIdentity } from "./nflTrendIdentity";

export type NflModelPlay = {
  game?: string;
  gameTime?: string;
  playType?: string;
  play?: string;
  role?: string;
  playerName?: string;
  playerTeam?: string;
  propMarket?: string;
  propSide?: string;
  propLine?: string | number;
  propProjection?: string | number;
  score?: string | number;
  marketOdds?: string;
  pending?: boolean;
  modelProjection?: number;
  modelProjectionAdjustment?: number;
  marketLine?: number;
  modelEdge?: number;
};

function text(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function identity(play: NflModelPlay) {
  const game = nflTrendGameIdentity({ game: play.game });
  if (play.playerName || play.propMarket) return `${game}|prop|${text(play.playerName)}|${text(play.propMarket)}`;
  const market = text(play.role || play.playType).includes("spread") ? "spread" : "total";
  return `${game}|${market}`;
}

/** Add early qualifiers to the existing board without replacing any finalized play. */
export function mergeNflPendingModelPlays<T extends NflModelPlay>(
  saved: T[], games: NflPendingGame[], props: NflPlayerProp[],
  slate: Record<string, string>[] = [], now = Date.now(),
): (T | NflModelPlay)[] {
  const finalizedGames = new Set(slate.filter(row => row["Build Phase"] !== "early"
    && (row["Build Phase"] === "pregame" || row["Model Version"] || row["Projected Away"]))
    .map(row => nflTrendGameIdentity({ game: row.Game || `${row["Away Team"]} @ ${row["Home Team"]}` })));
  const candidates: NflModelPlay[] = games
    .filter(game => Date.parse(game.gameTime) > now && !finalizedGames.has(nflTrendGameIdentity({ game: game.game })))
    .map(game => ({
      game: game.game, gameTime: game.gameTime, playType: game.grade,
      play: game.pick, role: game.market, marketOdds: "-110", pending: true,
      modelProjection: game.projection, marketLine: game.line, modelEdge: game.edge,
    }));
  for (const prop of upcomingNflProps(props, now, true)) {
    candidates.push({
      game: prop.game, gameTime: prop.gameTime, playType: prop.grade,
      play: `${prop.player} ${prop.pick}`, role: `Player Prop • ${prop.market}`,
      playerName: prop.player, playerTeam: prop.team, propMarket: prop.market,
      propSide: prop.pick.match(/\b(Over|Under)\b/i)?.[1] || "",
      propLine: prop.line ?? undefined, propProjection: prop.projection ?? undefined,
      score: prop.probability ?? undefined,
      marketOdds: prop.pickOdds == null ? "" : String(prop.pickOdds), pending: true,
    });
  }
  const seen = new Set(saved.map(identity));
  const merged: (T | NflModelPlay)[] = [...saved];
  for (const play of candidates) {
    const key = identity(play);
    if (!seen.has(key)) { seen.add(key); merged.push(play); }
  }
  return merged;
}
