from pathlib import Path

path = Path("lib/footballPublicDataCore.ts")
text = path.read_text()
old = '''  const weeklyMarket = await readWeeklyFootballMarket(
    sport,
    sport === "NCAAF" ? { dateKeys: [today], hydrateHistory: false } : {},
  );'''
new = '''  const weeklyMarket = await readWeeklyFootballMarket(
    sport,
    sport === "NCAAF"
      ? { dateKeys: [today], hydrateHistory: false }
      : { hydrateHistory: false },
  );'''
if text.count(old) != 1:
    raise SystemExit(f"Expected one public weekly market read block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
