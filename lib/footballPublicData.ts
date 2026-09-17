import { buildFootballPublicData as buildFootballPublicDataWithHistory } from "./footballPublicDataHistory";
import type { FootballSport } from "./sportSheets";

export {
  PUBLIC_SPLIT_HEADERS,
  ALL_GAME_TRENDS_HEADERS,
  __test__,
} from "./footballPublicDataHistory";
export type { FootballMarket } from "./footballPublicDataHistory";

export async function buildFootballPublicData(
  sport: FootballSport,
  options: { forceFresh?: boolean; persist?: boolean } = {},
): Promise<Record<string, any>> {
  return (await buildFootballPublicDataWithHistory(sport, options)) as Record<string, any>;
}
