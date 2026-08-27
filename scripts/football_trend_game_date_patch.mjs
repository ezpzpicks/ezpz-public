import { readFileSync, writeFileSync } from "node:fs";

const path = "lib/footballPublicData.ts";
let source = readFileSync(path, "utf8");

if (!source.includes("const trendGameDate=isoDate(row.Date||row[\"Game Date\"]||\"\")||split.date||referenceDate;")) {
  const target = '  return { date:referenceDate, game:String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`), gameKey:String(row["Game ID"]||row["Game Key"]||""), gameTime:gameTime(row), awayTeam:String(row["Away Team"]||""), homeTeam:String(row["Home Team"]||""), market:split.market,';
  const replacement = '  const trendGameDate=isoDate(row.Date||row["Game Date"]||"")||split.date||referenceDate;\n  return { date:trendGameDate, game:String(row.Game||`${row["Away Team"]} @ ${row["Home Team"]}`), gameKey:String(row["Game ID"]||row["Game Key"]||""), gameTime:gameTime(row), awayTeam:String(row["Away Team"]||""), homeTeam:String(row["Home Team"]||""), market:split.market,';
  if (!source.includes(target)) throw new Error("football buildTrendPlay date anchor not found");
  source = source.replace(target, replacement);
}

if (!source.includes("date:trendGameDate")) {
  throw new Error("football trend game date patch did not apply");
}

writeFileSync(path, source);
console.log("Applied actual football game date to weekly trend cards.");
