import { readFileSync, writeFileSync } from "node:fs";

const path = "app/FootballBoard.tsx";
let source = readFileSync(path, "utf8");

// The football board now owns the weekly selector, game date/time display,
// chronological ordering, and collapsed/expandable market rows directly.
// When that implementation is present, the legacy build-time patch must be a
// no-op rather than trying to rewrite old anchors that no longer exist.
if (source.includes("trendWeekControls") && source.includes("const gameDate =") && source.includes("displayedTrendGroups")) {
  console.log("Football weekly UI is implemented natively; legacy patch skipped.");
  process.exit(0);
}

if (!source.includes("gameKey: string; date?: string; gameTime?: string;")) {
  source = source.replace(
    "game: string; gameKey: string; gameTime?: string; market:",
    "game: string; gameKey: string; date?: string; gameTime?: string; market:",
  );
}

if (!source.includes("function footballDateTimeLabel(play: TrendPlay)")) {
  const anchor = "function selectedSplit(play: Play, splits: DraftKingsSplit[]) {";
  const helper = `function footballDateLabel(value: unknown) {\n  const raw = String(value || \"\").trim();\n  const iso = raw.match(/^(20\\d{2})-(\\d{1,2})-(\\d{1,2})/);\n  if (iso) return \`\${Number(iso[2])}/\${Number(iso[3])}\`;\n  const us = raw.match(/(\\d{1,2})\\/(\\d{1,2})/);\n  return us ? \`\${Number(us[1])}/\${Number(us[2])}\` : raw;\n}\n\nfunction footballDateTimeLabel(play: TrendPlay) {\n  const date = footballDateLabel(play.date);\n  const time = String(play.gameTime || \"\").trim();\n  if (date && time && !time.includes(date)) return \`\${date} • \${time}\`;\n  return time || date;\n}\n\nfunction footballScheduleSortValue(play: TrendPlay) {\n  const rawDate = String(play.date || \"\").trim();\n  const dateMatch = rawDate.match(/^(20\\d{2})-(\\d{1,2})-(\\d{1,2})/);\n  if (!dateMatch) return Number.POSITIVE_INFINITY;\n  const year = Number(dateMatch[1]);\n  const month = Number(dateMatch[2]);\n  const day = Number(dateMatch[3]);\n  let hour = 23;\n  let minute = 59;\n  const rawTime = String(play.gameTime || \"\").trim();\n  const timeMatch = rawTime.match(/(\\d{1,2})(?::(\\d{2}))?\\s*(AM|PM)?/i);\n  if (timeMatch) {\n    hour = Number(timeMatch[1]);\n    minute = Number(timeMatch[2] || 0);\n    const meridiem = String(timeMatch[3] || \"\").toUpperCase();\n    if (meridiem === \"PM\" && hour < 12) hour += 12;\n    if (meridiem === \"AM\" && hour === 12) hour = 0;\n  }\n  return Date.UTC(year, month - 1, day, hour, minute);\n}\n\n`;
  if (!source.includes(anchor)) throw new Error("FootballBoard selectedSplit anchor not found");
  source = source.replace(anchor, helper + anchor);
}

if (!source.includes('const gameDateTime = scheduled ? footballDateTimeLabel(scheduled) : "";')) {
  source = source.replace(
    '  const gameTime = ordered.find((play) => play.gameTime)?.gameTime || "";\n  const lockTime = scheduledLockTime(gameTime);',
    '  const scheduled = ordered.find((play) => play.gameTime || play.date);\n  const gameTime = ordered.find((play) => play.gameTime)?.gameTime || "";\n  const gameDateTime = scheduled ? footballDateTimeLabel(scheduled) : "";\n  const lockTime = scheduledLockTime(gameTime);',
  );
}

source = source.replace(
  '{gameTime ? <div className="trendGameTimeBox"><strong>{gameTime}</strong><small>{isLocked ? "Locked" : "Locks"} {lockTime}</small></div> : null}',
  '{gameDateTime ? <div className="trendGameTimeBox"><strong>{gameDateTime}</strong><small>{isLocked ? "Locked" : "Locks"} {lockTime}</small></div> : null}',
);

source = source.replace(
  '{gameTime ? <div className="trendGameTimeBox"><strong>{gameTime}</strong></div> : null}',
  '{gameDateTime ? <div className="trendGameTimeBox"><strong>{gameDateTime}</strong></div> : null}',
);

source = source.replace(/initiallyOpen=\{index === 0\}/g, "initiallyOpen={false}");

source = source.replace(
  '  const displayedTrendGroups = [...trendGroups.values()].sort((a, b) => a.game.localeCompare(b.game));',
  '  const displayedTrendGroups = [...trendGroups.values()].sort((a, b) => {\n    const aStart = Math.min(...a.plays.map(footballScheduleSortValue));\n    const bStart = Math.min(...b.plays.map(footballScheduleSortValue));\n    if (aStart !== bStart) return aStart - bStart;\n    return a.game.localeCompare(b.game);\n  });',
);

if (!source.includes("gameDateTime ? <div className=\"trendGameTimeBox\"")) {
  throw new Error("FootballBoard date/time label patch did not apply");
}
if (!source.includes("initiallyOpen={false}")) {
  throw new Error("FootballBoard collapsed-row patch did not apply");
}
if (!source.includes("a.plays.map(footballScheduleSortValue)")) {
  throw new Error("FootballBoard chronological trend sort patch did not apply");
}

writeFileSync(path, source);
console.log("Applied football weekly date/time, collapsed rows, chronological kickoff sorting, and preserved lock display.");
