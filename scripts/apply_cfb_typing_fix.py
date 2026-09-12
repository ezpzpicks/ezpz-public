from pathlib import Path

path = Path("lib/footballPublicDataLegacy.ts")
text = path.read_text()
old = "for (const play of headToHead(trends)) {"
new = "for (const play of headToHead(trends) as TrendPlay[]) {"
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit("CFB TrendPlay loop typing target not found")
path.write_text(text)
