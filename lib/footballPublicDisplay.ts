type ChartPoint = { snapshotTime?: string; line?: unknown; odds?: unknown; betsPct?: unknown; moneyPct?: unknown };

// Compact presentation only, after catalog evaluation. Keep both endpoints of
// every unchanged run and every actual quote change. Raw timestamps and all
// observations remain in storage and continue to drive timing-based rules.
export function compactFootballChartHistory<T extends ChartPoint>(points: T[]): T[] {
  const sameQuote = (a: T, b: T) => a.line === b.line && a.odds === b.odds
    && a.betsPct === b.betsPct && a.moneyPct === b.moneyPct;
  return points.filter((point, index) => index === 0 || index === points.length - 1
    || !sameQuote(point, points[index - 1]) || !sameQuote(point, points[index + 1]));
}

export function compactFootballPublicDisplay<T extends { trendPlays?: Record<string, any>[] }>(payload: T): T {
  return {
    ...payload,
    trendPlays: payload.trendPlays?.map(play => ({
      ...play,
      // Client badges use the already evaluated full-history memberships.
      movementHistory: Array.isArray(play.movementHistory) && play.catalogEvaluation
        ? compactFootballChartHistory(play.movementHistory) : play.movementHistory,
    })),
  };
}
