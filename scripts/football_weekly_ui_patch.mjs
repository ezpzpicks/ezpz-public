import { readFileSync, writeFileSync } from "node:fs";

const path = "app/FootballBoard.tsx";
let source = readFileSync(path, "utf8");

if (!source.includes("gameKey: string; date?: string; gameTime?: string;")) {
  source = source.replace(
    "game: string; gameKey: string; gameTime?: string; market:",
    "game: string; gameKey: string; date?: string; gameTime?: string; market:",
  );
}

if (!source.includes("function footballDateTimeLabel(play: TrendPlay)")) {
  const anchor = "function selectedSplit(play: Play, splits: DraftKingsSplit[]) {";
  const helper = `function footballDateLabel(value: unknown) {\n  const raw = String(value || \"\").trim();\n  const iso = raw.match(/^(20\\d{2})-(\\d{1,2})-(\\d{1,2})/);\n  if (iso) return \`\${Number(iso[2])}/\${Number(iso[3])}\`;\n  const us = raw.match(/(\\d{1,2})\\/(\\d{1,2})/);\n  return us ? \`\${Number(us[1])}/\${Number(us[2])}\` : raw;\n}\n\nfunction footballDateTimeLabel(play: TrendPlay) {\n  const date = footballDateLabel(play.date);\n  const time = String(play.gameTime || \"\").trim();\n  if (date && time && !time.includes(date)) return \`\${date} • \${time}\`;\n  return time || date;\n}\n\n`;
  if (!source.includes(anchor)) throw new Error("FootballBoard selectedSplit anchor not found");
  source = source.replace(anchor, helper + anchor);
}

source = source.replace(
  '  const gameTime = ordered.find((play) => play.gameTime)?.gameTime || "";',
  '  const scheduled = ordered.find((play) => play.gameTime || play.date);\n  const gameDateTime = scheduled ? footballDateTimeLabel(scheduled) : "";',
);

source = source.replace(
  '{gameTime ? <div className="trendGameTimeBox"><strong>{gameTime}</strong></div> : null}',
  '{gameDateTime ? <div className="trendGameTimeBox"><strong>{gameDateTime}</strong></div> : null}',
);

source = source.replace(/initiallyOpen=\{index === 0\}/g, "initiallyOpen={false}");

if (!source.includes("gameDateTime ? <div className=\"trendGameTimeBox\"")) {
  throw new Error("FootballBoard date/time label patch did not apply");
}
if (!source.includes("initiallyOpen={false}")) {
  throw new Error("FootballBoard collapsed-row patch did not apply");
}

writeFileSync(path, source);
console.log("Applied football weekly date/time and collapsed trend-row UI patch.");
