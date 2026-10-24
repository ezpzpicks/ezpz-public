import { unstable_cache } from "next/cache";
import { readNbaForecastHistory } from "./nbaForecasts";
import { updateNbaModelRecords } from "./nbaRecords";

// Read-only bridge for deployment before the next paced collector saves totals.
// Subsequent page loads use the collector's compact analysis row instead.
export const readNbaModelRecordSeed = unstable_cache(async (date: string) =>
  updateNbaModelRecords(undefined, await readNbaForecastHistory(date), [], Date.now()),
  ["nba-model-record-seed-v1"], { revalidate: 300 });
