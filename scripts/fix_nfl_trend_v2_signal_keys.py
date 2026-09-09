from pathlib import Path

path = Path("lib/footballPublicData.ts")
text = path.read_text()
old = '''function trendSignalKeys(play: any) {
  return new Set(
    (Array.isArray(play?.signals) ? play.signals : [])
      .map((signal: any) => String(signal?.signalKey || "").trim())
      .filter(Boolean),
  );
}'''
new = '''function trendSignalKeys(play: any) {
  const keys = (Array.isArray(play?.signals) ? play.signals : [])
    .map((signal: any) => String(signal?.signalKey || "").trim())
    .filter((key: string) => Boolean(key));
  return new Set<string>(keys);
}'''
if old not in text:
    raise SystemExit("Could not find generated trendSignalKeys block")
path.write_text(text.replace(old, new, 1))
