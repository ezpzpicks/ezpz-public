import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "lib", "footballPublicDataCore.ts");
let source = fs.readFileSync(target, "utf8");
let changed = false;
const marker = "NCAAF_EZPZ_MOVEMENT_RULES_V1";

function replaceOnce(oldValue, newValue, label) {
  if (source.includes(newValue)) return;
  if (!source.includes(oldValue)) throw new Error(`NCAAF EZPZ movement patch could not locate ${label}.`);
  source = source.replace(oldValue, newValue);
  changed = true;
}

if (!source.includes(marker)) {
  const helperAnchor = `function isNflMoneyMomentumSelectedSide(play: TrendPlay, sport: FootballSport) {\n  if (sport !== "NFL") return false;\n  const lineMove = selectedMarketMove(play);\n  const moneyMove = selectedMoneyMove(play);\n  return lineMove != null\n    && moneyMove != null\n    && lineMove >= NFL_MONEY_MOMENTUM_MIN_MARKET_MOVE_POINTS\n    && moneyMove >= NFL_MONEY_MOMENTUM_MIN_MONEY_MOVE_PCT;\n}\n\n`;
  const helperBlock = `${helperAnchor}// ${marker}\nconst NCAAF_TOTAL_DROP_FADE_MIN_POINTS = 1.5;\nconst NCAAF_SPREAD_TICKET_MOMENTUM_MIN_MOVE_POINTS = 1;\nconst NCAAF_SPREAD_TICKET_MOMENTUM_MIN_TICKET_MOVE_PCT = 7;\n\nfunction selectedPublicMove(play: Pick<TrendPlay, "betsPct" | "openingBetsPct" | "publicMovementPct">) {\n  const explicit = Number(play.publicMovementPct);\n  if (play.publicMovementPct != null && Number.isFinite(explicit)) return explicit;\n  const opening = Number(play.openingBetsPct);\n  const current = Number(play.betsPct);\n  if (!Number.isFinite(opening) || !Number.isFinite(current) || opening <= 0 || opening >= 100) return null;\n  return current - opening;\n}\n\nfunction ncaafEzpzMovementQualification(play: TrendPlay, sport: FootballSport) {\n  if (sport !== "NCAAF") return { labels: [] as string[], score: 0 };\n  const labels: string[] = [];\n  let score = 0;\n\n  if (play.market === "Total" && play.side === "Over") {\n    const opening = Number(play.openingLine);\n    const current = Number(play.line);\n    if (Number.isFinite(opening) && Number.isFinite(current) && opening - current >= NCAAF_TOTAL_DROP_FADE_MIN_POINTS) {\n      labels.push("Total Drop Fade");\n      score = Math.max(score, 95);\n    }\n  }\n\n  if (play.market === "Spread") {\n    const lineMove = selectedMarketMove(play);\n    const ticketMove = selectedPublicMove(play);\n    if (lineMove != null && ticketMove != null\n      && lineMove >= NCAAF_SPREAD_TICKET_MOMENTUM_MIN_MOVE_POINTS\n      && ticketMove >= NCAAF_SPREAD_TICKET_MOMENTUM_MIN_TICKET_MOVE_PCT) {\n      labels.push("Spread Ticket Momentum");\n      score = Math.max(score, 90);\n    }\n  }\n\n  return { labels, score };\n}\n\n`;
  replaceOnce(helperAnchor, helperBlock, "movement helper anchor");

  replaceOnce(
`  for (const play of trends) {\n    const direct = directTrendQualification(play, splits, sport, trends);\n    if (!direct.labels.length) continue;\n    const requiredCfbSplit = sport === "NCAAF"\n      && direct.labels.some((label) => label === "RLM" || label === "Sharp" || label === "Public Fade");\n    const odds = americanOddsText(play.odds) || (requiredCfbSplit ? "-110" : "");\n    if (!odds || (!requiredCfbSplit && Number(odds) < -150)) continue;\n\n    const strengthScore = direct.labels.includes("RLM")\n      ? Math.min(100, 85 + Math.max(0, Math.abs(Number(direct.publicSide?.lineMovementValue || 0)) - RLM_MIN_MARKET_MOVE_POINTS) * 5)\n      : 85;\n\n    picks.push({\n`,
`  for (const play of trends) {\n    const direct = directTrendQualification(play, splits, sport, trends);\n    const ncaafMovement = ncaafEzpzMovementQualification(play, sport);\n    const labels = sport === "NCAAF" ? ncaafMovement.labels : direct.labels;\n    if (!labels.length) continue;\n    const odds = americanOddsText(play.odds) || (sport === "NCAAF" ? "-110" : "");\n    if (!odds || Number(odds) < -150) continue;\n\n    const strengthScore = sport === "NCAAF"\n      ? ncaafMovement.score\n      : direct.labels.includes("RLM")\n        ? Math.min(100, 85 + Math.max(0, Math.abs(Number(direct.publicSide?.lineMovementValue || 0)) - RLM_MIN_MARKET_MOVE_POINTS) * 5)\n        : 85;\n\n    picks.push({\n`,
    "live NCAAF EZPZ promotion loop",
  );

  replaceOnce(
`      tier: direct.labels.join(" + "),\n      qualification: direct.labels.join(" • "),\n`,
`      tier: labels.join(" + "),\n      qualification: labels.join(" • "),\n`,
    "live NCAAF labels",
  );
}

replaceOnce(
`    for (const play of finalPlays) {\n      const direct = directTrendQualification(play, [], sport, finalPlays);\n      const labels = direct.labels.filter((label) => label === "RLM" || label === "Sharp" || label === "Public Fade");\n      if (!labels.length) continue;\n      const result = gradeFinalNcaafTrendPlay(play, trendRows);\n      if (!result) continue;\n      const oddsNumber = parseOdds(play.odds) || -110;\n      const strengthScore = labels.includes("RLM")\n        ? Math.min(100, 85 + Math.max(0, Math.abs(Number(direct.publicSide?.lineMovementValue || 0)) - RLM_MIN_MARKET_MOVE_POINTS) * 5)\n        : 85;\n`,
`    for (const play of finalPlays) {\n      const movement = ncaafEzpzMovementQualification(play, sport);\n      const labels = movement.labels;\n      if (!labels.length) continue;\n      const result = gradeFinalNcaafTrendPlay(play, trendRows);\n      if (!result) continue;\n      const oddsNumber = parseOdds(play.odds) || -110;\n      if (oddsNumber < -150) continue;\n      const strengthScore = movement.score;\n`,
  "FINAL_PREGAME historical movement selection",
);

replaceOnce(
`  // Every historical CFB split that qualified as RLM, Sharp, or Public Fade was an\n  // EZPZ pick, even if another market from the same game scored higher. Keep\n  // those rows during backdating; retain the old one-per-game behavior only for\n  // non-direct selections.\n  const requiredDirect = sorted.filter((candidate) =>\n    /(?:\\bRLM\\b|\\bSharp\\b|Public Fade)/i.test(candidate.qualification)\n  );\n`,
`  // Historical NCAAF EZPZ records use only the two validated movement-pattern\n  // mechanisms. RLM, Sharp, and Public Fade stay tracked but never become EZPZ.\n  const requiredDirect = sorted.filter((candidate) =>\n    /(?:Total Drop Fade|Spread Ticket Momentum)/i.test(candidate.qualification)\n  );\n`,
  "historical required movement selections",
);

replaceOnce(
`  // A visible CFB RLM/Sharp/Public Fade badge is a direct EZPZ promotion. Never let\n  // the normal one-pick-per-game collapse or model-play ordering hide one of\n  // those market sides. Keep the old one-per-game behavior for all other picks.\n  const requiredDirect = sorted.filter((pick) =>\n    /(?:\\bRLM\\b|\\bSharp\\b|Public Fade)/i.test(\`\${pick.qualification || ""} \${pick.tier || ""}\`)\n  );\n`,
`  // NCAAF EZPZ is intentionally limited to Total Drop Fade and Spread Ticket\n  // Momentum. RLM, Sharp, and Public Fade remain visible/tracked only.\n  const requiredDirect = sorted.filter((pick) =>\n    /(?:Total Drop Fade|Spread Ticket Momentum)/i.test(\`\${pick.qualification || ""} \${pick.tier || ""}\`)\n  );\n`,
  "live required movement selections",
);

fs.writeFileSync(target, source);
console.log(changed ? "Applied NCAAF EZPZ movement-rule patch." : "NCAAF EZPZ movement-rule patch already applied.");
