from pathlib import Path

path = Path("app/api/public-data/route.ts")
text = path.read_text()
old = '''    .filter((play): play is TrendPlay => Boolean(play));\n\n  return scoreHeadToHeadTrendPlays(rawPlays).sort((a, b) => {\n    const aGame = trendGameInstanceKey(a);'''
new = '''    .filter((play): play is NonNullable<typeof play> => play != null);\n\n  return scoreHeadToHeadTrendPlays(rawPlays).sort((a, b) => {\n    const aGame = trendGameInstanceKey(a);'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"Expected one generated type-guard match, found {count}")
path.write_text(text.replace(old, new, 1))
print("Doubleheader trend type guard fixed.")
