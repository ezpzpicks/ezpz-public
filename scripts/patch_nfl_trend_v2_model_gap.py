from pathlib import Path

lib_path = Path("lib/footballPublicData.ts")
board_path = Path("app/FootballBoard.tsx")
lib = lib_path.read_text()
board = board_path.read_text()

# Extend the public pick payload with explicit model-gap diagnostics.
lib = lib.replace(
    '  gapPct?: number;\n  snapshotStatus?: string;\n};',
    '  gapPct?: number;\n  modelGapPct?: number;\n  predictedWinPct?: number;\n  impliedProbabilityPct?: number;\n  trendModelVersion?: string;\n  snapshotStatus?: string;\n};',
    1,
)

old_trend_start = lib.index('function trendEzpzPick(play: any): NflEzpzPick | null {')
old_trend_end = lib.index('\nfunction dedupeEzpzPicks', old_trend_start)

model_block = '''type NflTrendModelSpec = {
  features: string[];
  median: number[];
  mean: number[];
  scale: number[];
  coef: number[];
  intercept: number;
};

type NflTrendModelState = {
  status: string;
  version: string;
  threshold: number;
  model: NflTrendModelSpec | null;
  reason: string;
};

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function impliedProbabilityPct(value: unknown) {
  const odds = parseAmericanOdds(value);
  if (odds == null || odds === 0) return null;
  return odds > 0
    ? (100 / (odds + 100)) * 100
    : (Math.abs(odds) / (Math.abs(odds) + 100)) * 100;
}

function parseNflTrendModelState(rows: SheetRow[]): NflTrendModelState {
  const row = rows.find((entry) => textKey(entry.Sport) === "nfl") || rows[0] || {};
  const status = String(row.Status || "COLLECTING").trim() || "COLLECTING";
  const version = String(row["Active Model Version"] || "").trim();
  const threshold = finiteNumber(row["Normal Gap"]) ?? 15;
  const raw = String(row["Active Model JSON"] || "").trim();
  let model: NflTrendModelSpec | null = null;
  if (version && raw) {
    try {
      const parsed = JSON.parse(raw) as NflTrendModelSpec;
      const size = Array.isArray(parsed.features) ? parsed.features.length : 0;
      const valid = size > 0
        && Array.isArray(parsed.median) && parsed.median.length === size
        && Array.isArray(parsed.mean) && parsed.mean.length === size
        && Array.isArray(parsed.scale) && parsed.scale.length === size
        && Array.isArray(parsed.coef) && parsed.coef.length === size
        && Number.isFinite(Number(parsed.intercept));
      if (valid) model = parsed;
    } catch {
      model = null;
    }
  }
  return {
    status,
    version,
    threshold,
    model,
    reason: String(row["Promotion Reason"] || "").trim(),
  };
}

function trendSignalKeys(play: any) {
  return new Set(
    (Array.isArray(play?.signals) ? play.signals : [])
      .map((signal: any) => String(signal?.signalKey || "").trim())
      .filter(Boolean),
  );
}

function trendSideGroup(play: any) {
  const direct = textKey(play?.sideGroup || "");
  if (direct) return direct;
  const market = textKey(play?.market || "");
  if (market === "total") return textKey(play?.side || play?.selection || "").startsWith("under") ? "under" : "over";
  const line = finiteNumber(play?.line);
  return line != null && line < 0 ? "favorite" : "underdog";
}

function nflTrendFeatureValue(play: any, feature: string, implied: number | null, signalKeys: Set<string>) {
  const side = trendSideGroup(play);
  const market = textKey(play?.market || "");
  if (feature === "implied") return implied;
  if (feature === "legacy") return finiteNumber(play?.score);
  if (feature === "gapPct") return finiteNumber(play?.gapPct);
  if (feature === "publicMovementPct") return finiteNumber(play?.publicMovementPct);
  if (feature === "sharpMovementPct") return finiteNumber(play?.sharpMovementPct);
  if (feature === "lineMovementValue") return finiteNumber(play?.lineMovementValue);
  if (feature === "market_spread") return market === "spread" ? 1 : 0;
  if (feature === "market_total") return market === "total" ? 1 : 0;
  if (feature === "side_favorite") return side === "favorite" ? 1 : 0;
  if (feature === "side_underdog") return side === "underdog" ? 1 : 0;
  if (feature === "side_over") return side === "over" ? 1 : 0;
  if (feature === "side_under") return side === "under" ? 1 : 0;
  if (feature.startsWith("sig_")) return signalKeys.has(feature.slice(4)) ? 1 : 0;
  return finiteNumber(play?.[feature]);
}

function scoreNflTrendPlay(play: any, state: NflTrendModelState) {
  const spec = state.model;
  if (!spec) return null;
  const implied = finiteNumber(play?.currentImpliedPct)
    ?? finiteNumber(play?.impliedPct)
    ?? impliedProbabilityPct(play?.odds);
  if (implied == null) return null;
  const signalKeys = trendSignalKeys(play);
  let linear = Number(spec.intercept);
  for (let i = 0; i < spec.features.length; i += 1) {
    const raw = nflTrendFeatureValue(play, spec.features[i], implied, signalKeys);
    const value = raw == null || !Number.isFinite(raw) ? Number(spec.median[i]) : raw;
    const scale = Number(spec.scale[i]) || 1;
    linear += Number(spec.coef[i]) * ((value - Number(spec.mean[i])) / scale);
  }
  const probability = linear >= 0
    ? 1 / (1 + Math.exp(-linear))
    : Math.exp(linear) / (1 + Math.exp(linear));
  const predictedWinPct = probability * 100;
  const modelGapPct = predictedWinPct - implied;
  return {
    ...play,
    predictedWinPct,
    impliedProbabilityPct: implied,
    modelGapPct,
    trendModelVersion: state.version,
  };
}

function scoreNflTrendBoard(plays: any[], state: NflTrendModelState) {
  if (!state.model) return [];
  const scored = plays
    .map((play) => scoreNflTrendPlay(play, state))
    .filter(Boolean) as any[];
  const groups = new Map<string, any[]>();
  for (const play of scored) {
    const key = `${textKey(play.game)}|${textKey(play.market)}`;
    const group = groups.get(key) || [];
    group.push(play);
    groups.set(key, group);
  }
  const winners: any[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Number(b.modelGapPct) - Number(a.modelGapPct));
    if (group[0]) winners.push(group[0]);
  }
  return winners;
}

function trendEzpzPick(play: any, threshold: number): NflEzpzPick | null {
  const modelGapPct = Number(play.modelGapPct);
  if (!Number.isFinite(modelGapPct) || modelGapPct < threshold) return null;
  const predictedWinPct = Number(play.predictedWinPct);
  const impliedPct = Number(play.impliedProbabilityPct);
  const line = play.line == null ? "" : `${Number(play.line) > 0 ? "+" : ""}${play.line}`;
  const selection = textKey(play.market) === "total"
    ? `${play.side || play.selection} ${line}`.trim()
    : `${play.selection || play.selectionTeam} ${line}`.trim();
  return {
    source: "Trend Play",
    game: play.game,
    market: textKey(play.market) === "total" ? "Total" : "Spread",
    selection,
    odds: formatAmericanOdds(play.odds) || String(play.odds || ""),
    score: Math.round(modelGapPct * 10) / 10,
    tier: `${threshold}%+ NFL V2 Model Gap`,
    qualification: `NFL V2 model gap +${modelGapPct.toFixed(1)}% • ${predictedWinPct.toFixed(1)}% predicted vs ${impliedPct.toFixed(1)}% implied • ${threshold}%+ Trend gate`,
    gapPct: modelGapPct,
    modelGapPct,
    predictedWinPct,
    impliedProbabilityPct: impliedPct,
    trendModelVersion: String(play.trendModelVersion || ""),
    snapshotStatus: String(play.snapshotStatus || "LIVE"),
  };
}
'''
lib = lib[:old_trend_start] + model_block + lib[old_trend_end:]

lib = lib.replace(
    '      gapPct: pick.gapPct ?? existing.gapPct,\n      snapshotStatus: pick.snapshotStatus || existing.snapshotStatus,',
    '      gapPct: pick.gapPct ?? existing.gapPct,\n      modelGapPct: pick.modelGapPct ?? existing.modelGapPct,\n      predictedWinPct: pick.predictedWinPct ?? existing.predictedWinPct,\n      impliedProbabilityPct: pick.impliedProbabilityPct ?? existing.impliedProbabilityPct,\n      trendModelVersion: pick.trendModelVersion || existing.trendModelVersion,\n      snapshotStatus: pick.snapshotStatus || existing.snapshotStatus,',
    1,
)

old_reads = '''  const [propRows, propTracker] = await Promise.all([
    readSportWorksheet("NFL", "prop_projections"),
    readSportWorksheet("NFL", "prop_tracker"),
  ]);'''
new_reads = '''  const [propRows, propTracker, trendModelRows] = await Promise.all([
    readSportWorksheet("NFL", "prop_projections"),
    readSportWorksheet("NFL", "prop_tracker"),
    readSportWorksheet("NFL", "trend_v2_models"),
  ]);
  const nflTrendModel = parseNflTrendModelState(trendModelRows);'''
if old_reads not in lib:
    raise SystemExit("Could not find NFL worksheet read block")
lib = lib.replace(old_reads, new_reads, 1)

old_selection = '''  const bestPicks = bestPlays.map(bestPlayEzpzPick).filter(Boolean) as NflEzpzPick[];
  const trendPicks = todayTrendPlays.map(trendEzpzPick).filter(Boolean) as NflEzpzPick[];
  const aiPicks = dedupeEzpzPicks([...bestPicks, ...trendPicks]);

  const ruleMessage = aiPicks.length
    ? `NFL EZPZ Picks live: Best Plays qualify only with a HOT Last-7 badge and price -150 or better. Trend Plays qualify only with Handle − Bets gap of +15% or higher. Net ROI is not used.`
    : `No NFL EZPZ Picks qualify right now. Best Play gate = HOT + -150 or better. Trend gate = +15% Handle − Bets gap. Net ROI is not used.`;'''
new_selection = '''  const bestPicks = bestPlays.map(bestPlayEzpzPick).filter(Boolean) as NflEzpzPick[];
  const scoredTrendPlays = scoreNflTrendBoard(todayTrendPlays, nflTrendModel);
  const trendPicks = scoredTrendPlays
    .map((play) => trendEzpzPick(play, nflTrendModel.threshold))
    .filter(Boolean) as NflEzpzPick[];
  const aiPicks = dedupeEzpzPicks([...bestPicks, ...trendPicks]);

  const trendRule = nflTrendModel.model
    ? `Trend gate = NFL V2 predicted win probability − market-implied probability ≥ +${nflTrendModel.threshold.toFixed(1)}%.`
    : `NFL Trend V2 is ${nflTrendModel.status || "COLLECTING"}; no Trend EZPZ pick can qualify until an active NFL regression is promoted.${nflTrendModel.reason ? ` ${nflTrendModel.reason}` : ""}`;
  const ruleMessage = aiPicks.length
    ? `NFL EZPZ Picks live: Best Play = HOT Last-7 + -150 or better. ${trendRule} Net ROI is not used.`
    : `No NFL EZPZ Picks qualify right now. Best Play = HOT Last-7 + -150 or better. ${trendRule} Net ROI is not used.`;'''
if old_selection not in lib:
    raise SystemExit("Could not find old NFL EZPZ selection block")
lib = lib.replace(old_selection, new_selection, 1)

lib = lib.replace(
    '      candidateCount: bestPlays.length + todayTrendPlays.length,\n      selectedCount: aiPicks.length,',
    '      candidateCount: bestPlays.length + scoredTrendPlays.length,\n      selectedCount: aiPicks.length,',
    1,
)
lib = lib.replace(
    '    aiPicks,\n    aiSelectorStatus:',
    '    aiPicks,\n    nflTrendV2: {\n      status: nflTrendModel.status,\n      version: nflTrendModel.version,\n      active: Boolean(nflTrendModel.model),\n      threshold: nflTrendModel.threshold,\n      reason: nflTrendModel.reason,\n    },\n    aiSelectorStatus:',
    1,
)

board = board.replace(
    '  gapPct?: number;\n  snapshotStatus?: string;',
    '  gapPct?: number;\n  modelGapPct?: number;\n  predictedWinPct?: number;\n  impliedProbabilityPct?: number;\n  trendModelVersion?: string;\n  snapshotStatus?: string;',
    1,
)
board = board.replace('  const gap = Number(pick.gapPct);', '  const gap = Number(pick.modelGapPct ?? pick.gapPct);', 1)
board = board.replace(
    '<small>Handle − Bets must be +15.0% or higher</small>',
    '<small>NFL V2 predicted win probability − market-implied probability must be +15.0% or higher</small>',
    1,
)
board = board.replace(
    'Net ROI, trend tier, all-green status, sample size, and price are not Trend qualification gates.',
    'Raw Handle − Bets is an input to the regression, not the 15% qualification gap. Net ROI is not a Trend gate.',
    1,
)
board = board.replace(
    'Best Play = HOT + -150 or better. Trend = +15% Handle − Bets gap.',
    'Best Play = HOT + -150 or better. Trend = NFL V2 model gap ≥ +15%.',
    1,
)
board = board.replace(
    '<div><b>📈 Trend</b><span>Handle − Bets gap ≥ +15%</span></div>',
    '<div><b>📈 Trend</b><span>NFL V2 model gap ≥ +15%</span></div>',
    1,
)

lib_path.write_text(lib)
board_path.write_text(board)
