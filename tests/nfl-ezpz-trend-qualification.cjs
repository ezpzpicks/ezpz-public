const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../lib/footballPublicDataHistory.ts"), "utf8")
  + "\nexport const testFunctions = { directNflTrendPick, directNflTrendPicks };\n";
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const moduleExports = {};
vm.runInNewContext(compiled.outputText, {
  exports: moduleExports,
  require: () => ({}),
  Date, Intl, console,
});
const { directNflTrendPick, directNflTrendPicks } = moduleExports.testFunctions;
const today = "2026-10-05";

function pair({
  game = "BAL @ DAL",
  market = "Total",
  lineMove = 1,
  moneyMove = 0,
  odds = "",
  opening = "2026-10-05T12:00:00Z",
  updated = "2026-10-05T14:00:00Z",
} = {}) {
  const total = market === "Total";
  const selected = {
    date: today, game, market,
    selection: total ? "Over" : "BAL",
    selectionTeam: total ? "" : "BAL",
    side: total ? "Over" : "",
    line: total ? 46.5 : 3.5,
    odds,
    betsPct: 40,
    moneyPct: 40 + moneyMove,
    openingBetsPct: 40,
    openingMoneyPct: 40,
    publicMovementPct: 0,
    sharpMovementPct: moneyMove,
    lineMovementBasis: total ? "Total Line" : "Spread Line",
    lineMovementValue: lineMove,
    openingSnapshotTime: opening,
    updatedAt: updated,
    snapshotStatus: "LIVE",
  };
  const opposite = {
    ...selected,
    selection: total ? "Under" : "DAL",
    selectionTeam: total ? "" : "DAL",
    side: total ? "Under" : "",
    line: total ? 46.5 : -3.5,
    betsPct: 60,
    moneyPct: 60 - moneyMove,
    openingBetsPct: 60,
    openingMoneyPct: 60,
    sharpMovementPct: -moneyMove,
    lineMovementValue: -lineMove,
  };
  return [selected, opposite];
}

test("legacy Sharp/Public Fade/RLM no longer qualify alone after the effective date", () => {
  const plays = pair({ lineMove: 0, moneyMove: 0 });
  Object.assign(plays[0], { betsPct: 20, moneyPct: 50 });
  Object.assign(plays[1], { betsPct: 80, moneyPct: 50 });
  assert.equal(directNflTrendPicks({ trendPlays: plays }, today).length, 0);
});

test("standalone total Market Move qualifies at 1.0 point with one hour of history", () => {
  const plays = pair({ lineMove: 1, moneyMove: 0 });
  const picks = directNflTrendPicks({ trendPlays: plays }, today);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].tier, "Market Move");
  assert.equal(picks[0].selection, "Over 46.5");
  assert.equal(picks[0].odds, "-110");
});

test("total Market Move plus 10-point money growth is the top class", () => {
  const plays = pair({ lineMove: 1, moneyMove: 10 });
  const picks = directNflTrendPicks({ trendPlays: plays }, today);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].tier, "Market Move + Total Money Momentum");
});

test("spread money momentum qualifies at 0.5 line move and 10-point money growth", () => {
  const plays = pair({ market: "Spread", lineMove: 0.5, moneyMove: 10 });
  const picks = directNflTrendPicks({ trendPlays: plays }, today);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].tier, "Spread Money Momentum");
  assert.equal(picks[0].selection, "BAL +3.5");
});

test("one-pick hierarchy prefers confirmed total over spread momentum over standalone market move", () => {
  const top = pair({ game: "BAL @ DAL", market: "Total", lineMove: 1, moneyMove: 10 });
  const spread = pair({ game: "BAL @ DAL", market: "Spread", lineMove: 0.5, moneyMove: 10 });
  let picks = directNflTrendPicks({ trendPlays: [...top, ...spread] }, today);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].tier, "Market Move + Total Money Momentum");

  const standalone = pair({ game: "KC @ LV", market: "Total", lineMove: 1, moneyMove: 0 });
  const spread2 = pair({ game: "KC @ LV", market: "Spread", lineMove: 0.5, moneyMove: 10 });
  picks = directNflTrendPicks({ trendPlays: [...standalone, ...spread2] }, today);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].tier, "Spread Money Momentum");
});

test("opposite same-market legacy signal causes a pass, while same-side confirmation does not", () => {
  const conflict = pair({ lineMove: 1, moneyMove: 0 });
  Object.assign(conflict[1], { betsPct: 30, moneyPct: 60 });
  assert.equal(directNflTrendPicks({ trendPlays: conflict }, today).length, 0);

  const confirm = pair({ game: "BUF @ NYJ", lineMove: 1, moneyMove: 0 });
  Object.assign(confirm[0], { betsPct: 30, moneyPct: 60 });
  const picks = directNflTrendPicks({ trendPlays: confirm }, today);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].tier, "Market Move");
});

test("new signals require at least one hour of tracked history", () => {
  const immature = pair({ lineMove: 1, moneyMove: 10, updated: "2026-10-05T12:59:00Z" });
  assert.equal(directNflTrendPicks({ trendPlays: immature }, today).length, 0);
  const mature = pair({ lineMove: 1, moneyMove: 10, updated: "2026-10-05T13:00:00Z" });
  assert.equal(directNflTrendPicks({ trendPlays: mature }, today).length, 1);
});

test("thresholds remain exact and known prices preserve the -150 cap", () => {
  assert.equal(directNflTrendPicks({ trendPlays: pair({ lineMove: 0.9, moneyMove: 0 }) }, today).length, 0);
  assert.equal(directNflTrendPicks({ trendPlays: pair({ market: "Spread", lineMove: 0.4, moneyMove: 10 }) }, today).length, 0);
  assert.equal(directNflTrendPicks({ trendPlays: pair({ market: "Spread", lineMove: 0.5, moneyMove: 9 }) }, today).length, 0);
  assert.equal(directNflTrendPicks({ trendPlays: pair({ lineMove: 1, moneyMove: 0, odds: "-150" }) }, today).length, 1);
  assert.equal(directNflTrendPicks({ trendPlays: pair({ lineMove: 1, moneyMove: 0, odds: "-151" }) }, today).length, 0);
});

test("Week 4 remains on the prior selector so finished games are not retroactively backfilled", () => {
  const plays = pair({ lineMove: 0, moneyMove: 0 });
  plays.forEach((play) => { play.date = "2026-10-04"; });
  Object.assign(plays[0], { betsPct: 20, moneyPct: 50 });
  Object.assign(plays[1], { betsPct: 80, moneyPct: 50 });
  const picks = directNflTrendPicks({ trendPlays: plays }, "2026-10-04");
  assert.equal(picks.length, 1);
  assert.equal(picks[0].tier, "Sharp + Public Fade");
});
