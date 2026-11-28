const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const source = stripTypeScriptTypes(
  fs.readFileSync(path.join(__dirname, "../lib/manualEzpzPicks.ts"), "utf8")
).replace(/^import manifest from .*;$/m, "const manifest = fixture;")
 .replace(/^import .* from "\.\/manualEzpzGameDelegation";$/m, "")
 .replace(/^import .* from ".*manualEzpzSettlement";$/m, "")
 .replace(/\bexport\s+(?=(?:const|function))/g, "");
const delegationSource = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, "../lib/manualEzpzGameDelegation.ts"), "utf8")).replace(/\bexport /g, "");
const { isMatchupSpreadSelection } = require("./load-typescript.cjs")(path.join(__dirname, "../lib/manualEzpzSettlement.ts"));
const now = Date.parse("2026-11-12T23:50:00Z");
const row = {
  id: "manual_test_ryan_approval", sport: "NCAAM", date: "2026-11-12",
  game: "Away @ Home", gameTime: "2026-11-13T00:00:00Z",
  market: "Spread", selection: "Home -3.5", line: -3.5, odds: "-110",
  approvedAt: "2026-11-12T23:40:00Z", approvedBy: "ChatGPT",
  selectedBy: "Ryan", status: "approved", result: "PENDING",
};
function picks(rows, clock = now) {
  const context = { fixture: { picks: rows }, Intl, Date, isMatchupSpreadSelection };
  vm.runInNewContext(delegationSource + "\n" + source + "\nthis.read = getApprovedManualPicks; this.mcp = manualPickForMcp;", context);
  return { rows: context.read(undefined, undefined, clock), mcp: context.mcp };
}
test("Ryan can select an official pick without ChatGPT/Muse research", () => {
  const { rows, mcp } = picks([row]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].selectedBy, "Ryan");
  assert.equal("reviewedWithMuse" in rows[0], false);
  assert.equal(mcp(rows[0]).pickCategory, "manual");
  assert.equal(mcp(rows[0]).gameKey, row.id);
  assert.equal(rows[0].line, row.line);
  assert.equal(rows[0].odds, row.odds);
  assert.equal(Date.parse(rows[0].approvedAt), Date.parse(row.approvedAt));
});
test("Muse metadata is historical context and cannot grant or block approval", () => {
  assert.equal(picks([{ ...row, reviewedWithMuse: false }]).rows.length, 1);
  const { selectedBy, ...candidate } = row;
  assert.equal(picks([{ ...candidate, reviewedWithMuse: true }]).rows.length, 0);
  assert.equal(picks([{ ...row, selectedBy: "ChatGPT", reviewedWithMuse: true }]).rows.length, 0);
});
test("new policy preserves approval timing and duplicate safeguards", () => {
  assert.equal(picks([row, row]).rows.length, 1);
  assert.equal(picks([{ ...row, approvedAt: "2026-11-12T23:55:00Z" }]).rows.length, 0);
  assert.equal(picks([{ ...row, approvedAt: "2026-11-13T00:01:00Z" }]).rows.length, 0);
  assert.equal(picks([{ ...row, status: "candidate" }]).rows.length, 0);
});

test("delegated NCAAM selection requires the reviewed mandate and accurate pregame provenance", () => {
  const entry = require("../data/manual-ezpz-picks.json").picks.find(p => p.id === "manual_20261127_ncaam_401921718_total_over_160_5");
  const clock = Date.parse(entry.approvedAt);
  const read = changes => picks([{ ...entry, ...changes }], clock);
  const verified = read({});
  assert.equal(verified.rows.length, 1);
  assert.equal(verified.rows[0].approvedBy, "Ryan");
  assert.equal(verified.rows[0].selectedBy, "ChatGPT");
  assert.equal(verified.mcp(verified.rows[0]).source, "ryan-delegated-chatgpt-selection");
  for (const change of [{ delegation: undefined }, { sport: "NBA" }, { selectedBy: "model" },
    { status: "candidate" }, { approvedBy: "ChatGPT" }, { approvedAt: "2026-11-26T21:00:00Z" },
    { gameTime: entry.approvedAt }]) assert.equal(read(change).rows.length, 0);
});

test("game-market delegation is individual, league-specific and pregame at source precision", () => {
  const entry = { ...row, date: "2026-11-28", gameTime: "2026-11-28T19:00:00Z",
    approvedAt: "2026-11-28T16:33:22.566507Z", delegation: "ezpz-nba-nfl-ncaaf-2026-11-28",
    selectedBy: "ChatGPT", approvedBy: "Ryan", sport: "NFL" };
  const clock = Date.parse("2026-11-28T18:00:00Z");
  const read = changes => picks([{ ...entry, ...changes }], clock).rows;
  for (const sport of ["NBA", "NFL", "NCAAF"]) {
    for (const market of [{}, { market: "Total", selection: "Under 43.5", line: 43.5 }]) {
      const [result] = read({ sport, ...market });
      assert.equal(result.delegation, entry.delegation);
      assert.equal(result.approvedAt, entry.approvedAt);
    }
  }
  assert.equal(read({approvedAt:"2026-11-28T11:33:22.566507-05:00"})[0].approvedAt, entry.approvedAt);
  for (const changes of [{ sport: "MLB" }, { sport: "NCAAM" }, { market: "Moneyline" }, { market: "Player Prop" },
    { market: "Team Total" }, { market: "First Half Spread" }, { selection: "Away Over 1.5", line: 1.5 },
    { market: "Total", selection: "Home Over 43.5", line: 43.5 }, { selection: "Unrelated Player -3.5" }, { line: null }, { line: 5 },
    { delegation: "ncaam-private-qualifiers-2026-11-27" }, { delegation: undefined }, { status: "candidate" },
    { selectedBy: "model" }, { approvedBy: "ChatGPT" }, { approvedAt: "2026-11-28T16:33:22.566506Z" },
    { approvedAt: "2026-11-28T18:00:00.000001Z" }, { approvedAt: entry.gameTime },
    { gameTime: "2026-11-28T16:33:22.566506Z" }, { approvedAt:"2026-11-28T17:00:00" }])
    assert.equal(read(changes).length, 0, JSON.stringify(changes));
});
