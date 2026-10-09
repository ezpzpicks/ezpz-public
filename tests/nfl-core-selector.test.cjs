const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

// Exercise the production selector without initializing storage or network clients.
const source = fs.readFileSync(path.join(__dirname, "../lib/footballPublicDataHistory.ts"), "utf8");
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(source + "\nexports.select = directNflTrendPicks;", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  exports: exportsForTest,
  require(name) {
    if (name === "./nflEzpzPolicy") return require("./load-typescript.cjs")(path.join(__dirname, "../lib/nflEzpzPolicy.ts"));
    assert.ok(["./footballPublicDataLegacy", "./ezpzPublicSplitEligibility", "./sportSheets", "./ncaafEzpzPolicy", "./ncaafTrendRecordPolicy"].includes(name));
    return {};
  },
});

const date = "2026-10-05";
const opening = "2026-10-05T12:00:00Z";
const updatedAt = "2026-10-05T16:00:00Z";
function board() {
  return {
    trendPlays: [
      { market: "Spread", selection: "ATL", line: 1.5, betsPct: 55, moneyPct: 73, openingMoneyPct: 44, sharpMovementPct: 29, lineMovementValue: 1, lineMovementBasis: "Spread Line" },
      { market: "Spread", selection: "NO", line: -1.5, betsPct: 45, moneyPct: 27, openingMoneyPct: 56, sharpMovementPct: -29, lineMovementValue: -1, lineMovementBasis: "Spread Line" },
      { market: "Total", selection: "Over", side: "Over", line: 47.5, betsPct: 55, moneyPct: 66, openingMoneyPct: 65, sharpMovementPct: 1, lineMovementValue: -1, lineMovementBasis: "Total Line" },
      { market: "Total", selection: "Under", side: "Under", line: 47.5, betsPct: 45, moneyPct: 34, openingMoneyPct: 35, sharpMovementPct: -1, lineMovementValue: 1, lineMovementBasis: "Total Line" },
    ].map(play => ({ ...play, game: "ATL @ NO", date, updatedAt, firstTrackedAt: opening, odds: "-110", snapshotStatus: "LIVE" })),
    draftKings: { splits: [] },
  };
}
function select(core) { return exportsForTest.select(core, date); }

test("weekly firstTrackedAt allows spread money momentum to outrank standalone market move", () => {
  const picks = select(board());
  assert.equal(picks.length, 1);
  assert.equal(picks[0].selection, "ATL +1.5");
  assert.equal(picks[0].tier, "Spread Money Momentum");
  assert.equal(picks[0].openingSnapshotTime, opening);
});

test("raw split fallback matches team abbreviations to full names on the same date", () => {
  const core = board();
  delete core.trendPlays[0].firstTrackedAt;
  core.draftKings.splits = [
    { game: "Atlanta Falcons at New Orleans Saints", date: "2026-09-28", market: "Spread", selection: "Atlanta Falcons +1.5", openingSnapshotTime: updatedAt },
    { game: "Atlanta Falcons at New Orleans Saints", date, market: "Spread", selection: "Atlanta Falcons +1.5", openingSnapshotTime: opening },
  ];
  assert.equal(select(core)[0].selection, "ATL +1.5");
});

test("combined total signals retain first priority", () => {
  const core = board();
  core.trendPlays[3].sharpMovementPct = 12;
  const picks = select(core);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].tier, "Market Move + Total Money Momentum");
});

test("immature or missing spread history cannot bypass the one-hour requirement", () => {
  for (const timestamp of ["2026-10-05T15:30:00Z", ""]) {
    const core = board();
    core.trendPlays[0].firstTrackedAt = timestamp;
    assert.equal(select(core)[0].tier, "Market Move");
  }
});

test("a signal on the opposing spread still passes the game", () => {
  const core = board();
  core.trendPlays[1].moneyPct = 75;
  assert.equal(select(core).length, 0);
});

test("an abbreviated and full-name copy of the same side is not a contradiction", () => {
  const core = board();
  core.trendPlays.push({ ...core.trendPlays[0], selection: "Atlanta Falcons" });
  assert.equal(select(core).length, 1);
});

test("missing football spread and total prices use -110 and keep signal priority", () => {
  for (const missing of ["", "  ", null, undefined]) {
    const spread = board();
    spread.trendPlays[0].odds = missing;
    assert.equal(select(spread)[0].selection, "ATL +1.5");
    assert.equal(select(spread)[0].odds, "-110");
    assert.equal(select(spread)[0].oddsSource, "DEFAULT_110");
    const total = board();
    total.trendPlays[3].sharpMovementPct = 12;
    total.trendPlays[3].odds = missing;
    assert.equal(select(total)[0].selection, "Under 47.5");
    assert.equal(select(total)[0].odds, "-110");
  }
  const priced = board();
  priced.trendPlays[0].odds = "-125";
  assert.equal(select(priced)[0].odds, "-125");
  assert.equal(select(priced)[0].oddsSource, "SNAPSHOT");
});
