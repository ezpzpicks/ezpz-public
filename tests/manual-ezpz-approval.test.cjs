const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const source = stripTypeScriptTypes(
  fs.readFileSync(path.join(__dirname, "../lib/manualEzpzPicks.ts"), "utf8")
).replace(/^import manifest from .*;$/m, "const manifest = fixture;")
 .replace(/\bexport\s+(?=(?:const|function))/g, "");
const now = Date.parse("2026-11-12T23:50:00Z");
const row = {
  id: "manual_test_ryan_approval", sport: "NCAAM", date: "2026-11-12",
  game: "Away @ Home", gameTime: "2026-11-13T00:00:00Z",
  market: "Spread", selection: "Home -3.5", line: -3.5, odds: "-110",
  approvedAt: "2026-11-12T23:40:00Z", approvedBy: "ChatGPT",
  selectedBy: "Ryan", status: "approved", result: "PENDING",
};
function picks(rows, clock = now) {
  const context = { fixture: { picks: rows }, Intl, Date };
  vm.runInNewContext(source + "\nthis.read = getApprovedManualPicks; this.mcp = manualPickForMcp;", context);
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
