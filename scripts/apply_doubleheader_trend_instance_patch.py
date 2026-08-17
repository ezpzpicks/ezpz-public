from pathlib import Path

path = Path("app/api/public-data/route.ts")
text = path.read_text()

replacements = []

replacements.append((
'''    score,\n    tier: "Pass",\n    signals,\n    updatedAt,\n  };\n}\n''',
'''    score,\n    tier: "Pass",\n    signals,\n    updatedAt,\n    recordDate: isoPublicDate(split.date),\n    recordGameTime: parseEventTimeKey(split.eventTime || ""),\n  };\n}\n'''
))

replacements.append((
'''function trendGameComparisonKey(play: TrendPlay) {\n  return `${normalizeTeam(play.awayTeam)}|${normalizeTeam(play.homeTeam)}`;\n}\n\nfunction frozenTrendPlayMetrics(play: TrendPlay) {\n''',
'''function trendGameComparisonKey(play: TrendPlay) {\n  return `${normalizeTeam(play.awayTeam)}|${normalizeTeam(play.homeTeam)}`;\n}\n\nfunction trendGameInstanceKey(play: TrendPlay) {\n  const matchup = trendGameComparisonKey(play);\n  const gameTime = parseEventTimeKey(play.recordGameTime || "");\n  if (gameTime) return `${matchup}|${gameTime}`;\n  const gameKey = String(play.recordGameKey || "").trim().replace(/\\.0$/, "");\n  return gameKey ? `${matchup}|game:${gameKey}` : matchup;\n}\n\nfunction trendSlateGameInstanceKey(row: SheetRow) {\n  const matchup = `${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(\n    row["Home Team"] || "",\n  )}`;\n  const gameTime = scheduledGameTimeKey(row);\n  if (gameTime) return `${matchup}|${gameTime}`;\n  const gameKey = String(row["Game Key"] || "").trim().replace(/\\.0$/, "");\n  return gameKey ? `${matchup}|game:${gameKey}` : matchup;\n}\n\nfunction trendSlateRowForSplit(split: DraftKingsSplit, slateRows: SheetRow[]) {\n  const splitDate = isoPublicDate(split.date);\n  const matchupRows = slateRows.filter((row) => {\n    const rowDate = isoPublicDate(row.Date || "");\n    return (\n      (!splitDate || !rowDate || splitDate === rowDate) &&\n      normalizeTeam(row["Away Team"] || "") === normalizeTeam(split.awayTeam) &&\n      normalizeTeam(row["Home Team"] || "") === normalizeTeam(split.homeTeam)\n    );\n  });\n  const splitTime = parseEventTimeKey(split.eventTime || "");\n  if (splitTime) {\n    const exact = matchupRows.find(\n      (row) => scheduledGameTimeKey(row) === splitTime,\n    );\n    if (exact) return exact;\n  }\n  // A time-less legacy split is safe only when this matchup occurs once that\n  // day. On doubleheaders it is ambiguous and must not enter trend scoring.\n  return matchupRows.length === 1 ? matchupRows[0] : null;\n}\n\nfunction frozenTrendPlayMetrics(play: TrendPlay) {\n'''
))

replacements.append((
'''        trendGameComparisonKey(candidate.play) === trendGameComparisonKey(play) &&\n        trendMarketComparisonKey(candidate.play) === trendMarketComparisonKey(play),\n''',
'''        trendGameInstanceKey(candidate.play) === trendGameInstanceKey(play) &&\n        trendMarketComparisonKey(candidate.play) === trendMarketComparisonKey(play),\n'''
))

replacements.append((
'''  for (const play of plays) {\n    const key = trendGameComparisonKey(play);\n    const current = byGame.get(key) || [];\n''',
'''  for (const play of plays) {\n    const key = trendGameInstanceKey(play);\n    const current = byGame.get(key) || [];\n'''
))

replacements.append((
'''        `${trendGameComparisonKey(play)}|${trendMarketComparisonKey(play)}|${trendSideComparisonKey(play)}`,\n''',
'''        `${trendGameInstanceKey(play)}|${trendMarketComparisonKey(play)}|${trendSideComparisonKey(play)}`,\n'''
))

replacements.append((
'''  const gameKey = `${normalizeTeam(slateRow["Away Team"] || "")}|${normalizeTeam(\n    slateRow["Home Team"] || "",\n  )}`;\n  const candidates = plays.filter(\n    (play) =>\n      trendGameComparisonKey(play) === gameKey &&\n      play.market === market,\n  );\n''',
'''  const gameKey = trendSlateGameInstanceKey(slateRow);\n  const candidates = plays.filter(\n    (play) =>\n      trendGameInstanceKey(play) === gameKey &&\n      play.market === market,\n  );\n'''
))

old_build = '''function buildTrendPlays(\n  splits: DraftKingsSplit[],\n  history: DraftKingsSignalResult[],\n  slateRows: SheetRow[],\n  referenceDate: string,\n  updatedAt: string,\n) {\n  const slateOrder = new Map(\n    slateRows.map((row, index) => [\n      `${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(row["Home Team"] || "")}`,\n      index,\n    ]),\n  );\n  const rawPlays = splits\n    .filter(\n      (split) =>\n        isoPublicDate(split.date) === isoPublicDate(referenceDate) &&\n        (split.market === "Moneyline" || split.market === "Total") &&\n        slateOrder.has(\n          `${normalizeTeam(split.awayTeam)}|${normalizeTeam(split.homeTeam)}`,\n        ),\n    )\n    .map((split) =>\n      buildTrendPlayForSplit(\n        split,\n        history,\n        referenceDate,\n        split.snapshotTime || split.lastSeenAt || updatedAt,\n      ),\n    )\n    .filter((play): play is TrendPlay => Boolean(play));\n\n  return scoreHeadToHeadTrendPlays(rawPlays).sort((a, b) => {\n    const aGame = trendGameComparisonKey(a);\n    const bGame = trendGameComparisonKey(b);\n    const gameOrder =\n      (slateOrder.get(aGame) ?? Number.POSITIVE_INFINITY) -\n      (slateOrder.get(bGame) ?? Number.POSITIVE_INFINITY);\n    if (gameOrder) return gameOrder;\n    if (b.score !== a.score) return b.score - a.score;\n    return trendPickLabel(a).localeCompare(trendPickLabel(b));\n  });\n}\n'''
new_build = '''function buildTrendPlays(\n  splits: DraftKingsSplit[],\n  history: DraftKingsSignalResult[],\n  slateRows: SheetRow[],\n  referenceDate: string,\n  updatedAt: string,\n) {\n  const slateOrder = new Map(\n    slateRows.map((row, index) => [trendSlateGameInstanceKey(row), index]),\n  );\n  const rawPlays = splits\n    .filter(\n      (split) =>\n        isoPublicDate(split.date) === isoPublicDate(referenceDate) &&\n        (split.market === "Moneyline" || split.market === "Total"),\n    )\n    .map((split) => {\n      const slateRow = trendSlateRowForSplit(split, slateRows);\n      if (!slateRow) return null;\n      const play = buildTrendPlayForSplit(\n        split,\n        history,\n        referenceDate,\n        split.snapshotTime || split.lastSeenAt || updatedAt,\n      );\n      if (!play) return null;\n      return {\n        ...play,\n        recordDate: isoPublicDate(slateRow.Date || split.date),\n        recordGameKey: String(slateRow["Game Key"] || "").trim().replace(/\\.0$/, ""),\n        recordGameTime:\n          scheduledGameTimeKey(slateRow) ||\n          parseEventTimeKey(split.eventTime || ""),\n      };\n    })\n    .filter((play): play is TrendPlay => Boolean(play));\n\n  return scoreHeadToHeadTrendPlays(rawPlays).sort((a, b) => {\n    const aGame = trendGameInstanceKey(a);\n    const bGame = trendGameInstanceKey(b);\n    const gameOrder =\n      (slateOrder.get(aGame) ?? Number.POSITIVE_INFINITY) -\n      (slateOrder.get(bGame) ?? Number.POSITIVE_INFINITY);\n    if (gameOrder) return gameOrder;\n    if (b.score !== a.score) return b.score - a.score;\n    return trendPickLabel(a).localeCompare(trendPickLabel(b));\n  });\n}\n'''
replacements.append((old_build, new_build))

replacements.append((
'''  const overlayKey = (play: TrendPlay) =>\n    `${trendGameComparisonKey(play)}|${trendMarketComparisonKey(play)}|${trendSideComparisonKey(play)}`;\n''',
'''  const overlayKey = (play: TrendPlay) =>\n    `${trendGameInstanceKey(play)}|${trendMarketComparisonKey(play)}|${trendSideComparisonKey(play)}`;\n'''
))

replacements.append((
'''  const frozenGameKeys = new Set(\n    refreshedFrozenPlays.map((play) => trendGameComparisonKey(play)),\n  );\n  const combined = [\n    ...livePlays.filter(\n      (play) => !frozenGameKeys.has(trendGameComparisonKey(play)),\n    ),\n    ...refreshedFrozenPlays,\n  ];\n  const slateOrder = new Map(\n    slateRows.map((row, index) => [\n      `${normalizeTeam(row["Away Team"] || "")}|${normalizeTeam(row["Home Team"] || "")}`,\n      index,\n    ]),\n  );\n\n  return combined.sort((a, b) => {\n    const aGame = trendGameComparisonKey(a);\n    const bGame = trendGameComparisonKey(b);\n''',
'''  const frozenGameKeys = new Set(\n    refreshedFrozenPlays.map((play) => trendGameInstanceKey(play)),\n  );\n  const combined = [\n    ...livePlays.filter(\n      (play) => !frozenGameKeys.has(trendGameInstanceKey(play)),\n    ),\n    ...refreshedFrozenPlays,\n  ];\n  const slateOrder = new Map(\n    slateRows.map((row, index) => [trendSlateGameInstanceKey(row), index]),\n  );\n\n  return combined.sort((a, b) => {\n    const aGame = trendGameInstanceKey(a);\n    const bGame = trendGameInstanceKey(b);\n'''
))

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match, found {count}: {old[:120]!r}")
    text = text.replace(old, new, 1)

required = [
    "function trendGameInstanceKey(play: TrendPlay)",
    "function trendSlateGameInstanceKey(row: SheetRow)",
    "function trendSlateRowForSplit(split: DraftKingsSplit, slateRows: SheetRow[])",
    "recordGameTime: parseEventTimeKey(split.eventTime || \"\")",
    "trendGameInstanceKey(candidate.play) === trendGameInstanceKey(play)",
]
for needle in required:
    if needle not in text:
        raise SystemExit(f"Missing expected patched marker: {needle}")

path.write_text(text)
print("Doubleheader trend-instance patch applied.")
