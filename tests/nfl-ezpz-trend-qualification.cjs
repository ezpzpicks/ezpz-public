const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Exercise the production selector without network calls or storage writes.
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
const today = "2026-09-27";

function sides({ sharp = false, fade = false, rlm = false, market = "Total", odds = "" } = {}) {
  const bets = fade ? 15 : 40;
  const money = bets + (sharp ? 30 : 0);
  const base = { date: today, game: "BAL @ DAL", market, line: market === "Total" ? 53.5 : 3.5,
    odds, lineMovementBasis: market + " Line", snapshotStatus: "FINAL_PREGAME" };
  return [
    { ...base, selection: market === "Total" ? "Over" : "BAL", side: market === "Total" ? "Over" : "",
      betsPct: bets, moneyPct: money, openingBetsPct: bets + (rlm ? 10 : 0),
      publicMovementPct: rlm ? -10 : 0, lineMovementValue: rlm ? 2 : 0 },
    { ...base, selection: market === "Total" ? "Under" : "DAL", side: market === "Total" ? "Under" : "",
      line: market === "Total" ? 53.5 : -3.5,
      betsPct: 100 - bets, moneyPct: 100 - money, openingBetsPct: 100 - bets - (rlm ? 10 : 0),
      publicMovementPct: rlm ? 10 : 0, lineMovementValue: rlm ? -2 : 0 },
  ];
}

test("Baltimore-Dallas Over 53.5 retains Sharp and Public Fade with a missing price", () => {
  const plays = sides({ sharp: true, fade: true });
  Object.assign(plays[0], { betsPct: 17, moneyPct: 49, openingBetsPct: 13, publicMovementPct: 4, lineMovementValue: 1 });
  Object.assign(plays[1], { betsPct: 83, moneyPct: 51, openingBetsPct: 87, publicMovementPct: -4, lineMovementValue: -1 });
  const pick = directNflTrendPick(plays[0], plays, today);
  assert.ok(pick);
  assert.equal(pick.selection, "Over 53.5");
  assert.equal(pick.tier, "Sharp + Public Fade");
  assert.equal(pick.odds, "-110");
  assert.equal(pick.oddsSource, "DEFAULT_110");
});

test("all seven signal combinations qualify once for spreads and totals", () => {
  for (const market of ["Spread", "Total"]) {
    for (let mask = 1; mask < 8; mask++) {
      const sharp = Boolean(mask & 1), fade = Boolean(mask & 2), rlm = Boolean(mask & 4);
      const plays = sides({ sharp, fade, rlm, market });
      const picks = directNflTrendPicks({ trendPlays: [...plays, ...plays] }, today);
      assert.equal(picks.length, 1, market + " combination " + mask);
      assert.equal(picks[0].tier, [sharp && "Sharp", fade && "Public Fade", rlm && "RLM"].filter(Boolean).join(" + "));
      assert.equal(picks[0].market, market);
      assert.equal(picks[0].selection, market === "Total" ? "Over 53.5" : "BAL +3.5");
    }
  }
});

test("known prices retain the -150 cap regardless of the number of signals", () => {
  const plays = sides({ sharp: true, fade: true, rlm: true });
  for (const odds of ["-112", "-150", "+105"]) {
    const pick = directNflTrendPick({ ...plays[0], odds }, plays, today);
    assert.equal(pick.odds, odds);
    assert.equal(pick.oddsSource, "SNAPSHOT");
  }
  assert.equal(directNflTrendPick({ ...plays[0], odds: "-151" }, plays, today), null);
});

test("fallback prices do not admit unqualified plays, player props, or missing lines", () => {
  const plain = sides();
  assert.equal(directNflTrendPick(plain[0], plain, today), null);
  const plays = sides({ sharp: true, fade: true, rlm: true });
  assert.equal(directNflTrendPick({ ...plays[0], market: "Player Prop" }, plays, today), null);
  for (const line of [null, undefined, "", "bad"]) {
    assert.equal(directNflTrendPick({ ...plays[0], line }, plays, today), null);
  }
  assert.equal(directNflTrendPicks({ trendPlays: plays }, "2026-09-28").length, 0);
});

test("the existing Sharp, Public Fade, and RLM boundaries remain in effect", () => {
  const plays = sides({ sharp: true });
  assert.ok(directNflTrendPick({ ...plays[0], moneyPct: plays[0].betsPct + 25 }, plays, today));
  assert.equal(directNflTrendPick({ ...plays[0], moneyPct: plays[0].betsPct + 24 }, plays, today), null);
  const fade = sides({ fade: true });
  fade[1].betsPct = 79;
  assert.equal(directNflTrendPick(fade[0], fade, today), null);
  fade[1].betsPct = 80;
  assert.ok(directNflTrendPick(fade[0], fade, today));
  Object.assign(fade[1], { betsPct: 100, moneyPct: 100 });
  assert.equal(directNflTrendPick(fade[0], fade, today), null);
  const rlm = sides({ rlm: true });
  rlm[1].openingBetsPct = 100;
  assert.equal(directNflTrendPick(rlm[0], rlm, today), null);
});
