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

export function compactFootballPublicDisplay<T extends { trendPlays?: Record<string, any>[] }>(payload: T, compactCatalog = false, compactCharts = false, compactNflRecords = false): T {
  const display = {
    ...payload,
    trendPlays: payload.trendPlays?.map(play => ({
      ...play,
      // Client badges use the already evaluated full-history memberships.
      movementHistory: Array.isArray(play.movementHistory) && play.catalogEvaluation
        ? compactFootballChartHistory(play.movementHistory) : play.movementHistory,
    })),
  };
  if (!compactCatalog) return display;
  const groups: string[][] = [], indexes = new Map<string, number>();
  const chartKeys = ['snapshotTime', 'line', 'odds', 'betsPct', 'moneyPct'];
  const charts: unknown[][][] = [], chartIndexes = new Map<string, number>();
  const packHistory = (history: unknown) => {
    if (!compactCharts || !Array.isArray(history) || !history.length || !history.every(point => point
      && typeof point === 'object' && Object.keys(point).length === chartKeys.length
      && chartKeys.every(key => Object.hasOwn(point, key) && point[key] !== undefined))) return history;
    // A lossless wire format: retain every observation, including unchanged
    // heartbeats, and share histories repeated in picks and Signals evidence.
    const tuples = history.map(point => chartKeys.map(key => point[key]));
    const key = JSON.stringify(tuples);
    if (!chartIndexes.has(key)) { chartIndexes.set(key, charts.length); charts.push(tuples); }
    return { footballChart: chartIndexes.get(key)! };
  };
  const intern = (values: string[] = []) => {
    const key = JSON.stringify(values);
    if (!indexes.has(key)) { indexes.set(key, groups.length); groups.push(values); }
    return indexes.get(key)!;
  };
  const pack = (e: Record<string, any>) => ({
    v: e.version, m: (e.memberships || []).map((m: Record<string, any>) => [m.pair, m.direction, intern(m.filters)]),
    n: intern(e.missing), a: intern(e.ambiguous), ...(e.invalid ? { i: e.invalid } : {}),
  });
  const row = (value: Record<string, any>) => {
    const next = { ...value };
    if (next.movementHistory) next.movementHistory = packHistory(next.movementHistory);
    if (next.catalogEvaluation) next.catalogEvaluation = pack(next.catalogEvaluation);
    if (next['Catalog Membership JSON']) {
      try { next['Catalog Membership JSON'] = JSON.stringify(pack(JSON.parse(next['Catalog Membership JSON']))); } catch {}
    }
    return next;
  };
  const next: Record<string, any> = { ...display };
  for (const key of ['trendPlays', 'trendRecordRows', 'aiPicks', 'aiPickRecordRows']) {
    if (Array.isArray(next[key])) next[key] = next[key].map(row);
  }
  if (compactNflRecords && Array.isArray(next.ezpzRecords?.history)) next.ezpzRecords = {
    ...next.ezpzRecords, history: next.ezpzRecords.history.map(row),
  };
  if (next.footballSignals?.sides) next.footballSignals = {
    ...next.footballSignals,
    sides: next.footballSignals.sides.map((side: Record<string, any>) => side.marketContext ? {
      ...side, marketContext: { ...side.marketContext, history: packHistory(side.marketContext.history) },
    } : side),
  };
  // Repeated filter/missing-input lists dominate large catalog responses.
  // This opt-in wire format is lossless and expanded once before UI rendering.
  next.catalogFilterGroups = groups;
  if (charts.length) next.chartHistoryGroups = charts;
  return next as T;
}

export function restoreFootballPublicDisplay<T>(payload: T): T {
  const data = payload as Record<string, any>;
  if (!Array.isArray(data.catalogFilterGroups)) return payload;
  const groups = data.catalogFilterGroups as string[][];
  const chartKeys = ['snapshotTime', 'line', 'odds', 'betsPct', 'moneyPct'];
  const charts = (data.chartHistoryGroups || []).map((points: unknown[][]) => points.map(
    values => Object.fromEntries(chartKeys.map((key, i) => [key, values[i]])),
  ));
  const unpackHistory = (history: any) => history && !Array.isArray(history)
    && Number.isInteger(history.footballChart) && charts[history.footballChart]
    ? charts[history.footballChart] : history;
  const unpack = (e: Record<string, any>) => e.v ? {
    version: e.v, memberships: (e.m || []).map(([pair, direction, filters]: [string, number, number]) => ({ pair, direction, filters: groups[filters] || [] })),
    missing: groups[e.n] || [], ambiguous: groups[e.a] || [], ...(e.i ? { invalid: e.i } : {}),
  } : e;
  const row = (value: Record<string, any>) => {
    const next = { ...value };
    if (next.movementHistory) next.movementHistory = unpackHistory(next.movementHistory);
    if (next.catalogEvaluation) next.catalogEvaluation = unpack(next.catalogEvaluation);
    if (next['Catalog Membership JSON']) {
      try { next['Catalog Membership JSON'] = JSON.stringify(unpack(JSON.parse(next['Catalog Membership JSON']))); } catch {}
    }
    return next;
  };
  const next = { ...data };
  for (const key of ['trendPlays', 'trendRecordRows', 'aiPicks', 'aiPickRecordRows']) {
    if (Array.isArray(next[key])) next[key] = next[key].map(row);
  }
  if (Array.isArray(next.ezpzRecords?.history)) next.ezpzRecords = {
    ...next.ezpzRecords, history: next.ezpzRecords.history.map(row),
  };
  if (next.footballSignals?.sides) next.footballSignals = {
    ...next.footballSignals,
    sides: next.footballSignals.sides.map((side: Record<string, any>) => side.marketContext ? {
      ...side, marketContext: { ...side.marketContext, history: unpackHistory(side.marketContext.history) },
    } : side),
  };
  delete next.catalogFilterGroups;
  delete next.chartHistoryGroups;
  if (next.footballWeeklyMarket) next.footballWeeklyMarket = restoreFootballPublicDisplay(next.footballWeeklyMarket);
  return next as T;
}
