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

export function compactFootballPublicDisplay<T extends { trendPlays?: Record<string, any>[] }>(payload: T, compactCatalog = false): T {
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
  // Repeated filter/missing-input lists dominate large catalog responses.
  // This opt-in wire format is lossless and expanded once before UI rendering.
  next.catalogFilterGroups = groups;
  return next as T;
}

export function restoreFootballPublicDisplay<T>(payload: T): T {
  const data = payload as Record<string, any>;
  if (!Array.isArray(data.catalogFilterGroups)) return payload;
  const groups = data.catalogFilterGroups as string[][];
  const unpack = (e: Record<string, any>) => e.v ? {
    version: e.v, memberships: (e.m || []).map(([pair, direction, filters]: [string, number, number]) => ({ pair, direction, filters: groups[filters] || [] })),
    missing: groups[e.n] || [], ambiguous: groups[e.a] || [], ...(e.i ? { invalid: e.i } : {}),
  } : e;
  const row = (value: Record<string, any>) => {
    const next = { ...value };
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
  delete next.catalogFilterGroups;
  return next as T;
}
