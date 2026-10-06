const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { buildNflEzpzRecords: records } = require("./load-typescript.cjs")(path.join(__dirname, "../lib/nflEzpzRecords.ts"));

const today = "2026-10-06";
function falcons(overrides = {}) {
  return {
    date: "2026-10-05", game: "ATL @ NO", market: "Spread", selection: "ATL +1.5",
    source: "Trend Play", tier: "Spread Money Momentum", odds: "-110",
    snapshotStatus: "FINAL_PREGAME", result: "W", ...overrides,
  };
}
function under(overrides = {}) {
  return falcons({ market: "Total", selection: "Under 47.5", tier: "Market Move", result: "L", ...overrides });
}

test("Falcons win is counted once and superseded Under is excluded, regardless of row order", () => {
  for (const rows of [[under(), falcons()], [falcons(), under()]]) {
    const summary = records(rows, today);
    assert.equal(summary.last7Days.record, "1-0-0");
    assert.equal(summary.last7Days.unitsWon, 0.91);
    assert.equal(summary.history.length, 1);
    assert.equal(summary.history[0].selection, "ATL +1.5");
  }
});

test("full NFL team names and abbreviations represent the same game", () => {
  const summary = records([falcons(), falcons({ game: "Atlanta Falcons at New Orleans Saints", selection: "Atlanta Falcons +1.5" })], today);
  assert.equal(summary.last7Days.totalBets, 1);
});

test("combined total outranks spread; a pending chosen pick cannot be replaced by a settled loser", () => {
  const combined = under({ tier: "Market Move + Total Money Momentum", result: "Pending" });
  const summary = records([falcons(), under(), combined], today);
  assert.equal(summary.last7Days.totalBets, 0);
  assert.equal(summary.history[0].tier, combined.tier);
});

test("a frozen final owns the game before settlement, even over a higher-priority live preview", () => {
  const summary = records([falcons(), under({ snapshotStatus: "FINAL_PREGAME", result: "" })], today);
  assert.equal(summary.last7Days.totalBets, 0);
  assert.equal(summary.history[0].selection, "Under 47.5");
});

test("seven calendar days includes September 30 through October 6, with no seven-bet limit", () => {
  const rows = Array.from({ length: 9 }, (_, i) => falcons({ date: "2026-09-30", game: `Visitor${i} @ Host${i}`, tier: "Sharp" }));
  rows.push(falcons({ date: "2026-09-29", game: "Older @ Game", tier: "Sharp", result: "L" }));
  rows.push(falcons({ date: today, game: "Today @ Game", result: "P" }));
  rows.push(falcons({ date: "2026-10-07", game: "Future @ Game", result: "L" }));
  rows.push(falcons({ date: "invalid", result: "L" }));
  const summary = records(rows, today);
  assert.equal(summary.windowStart, "2026-09-30");
  assert.equal(summary.last7Days.record, "9-0-1");
  assert.equal(summary.overall.record, "9-1-1");
});

test("settled legacy LIVE picks count; legacy rules are not reapplied as the October 5 selector", () => {
  const rows = [
    falcons(), under(),
    under({ date: "2026-10-01", game: "PIT @ CLE", selection: "Under 38.5", tier: "Public Fade" }),
    falcons({ date: "2026-10-04", game: "DAL @ HOU", selection: "HOU -3", tier: "Public Fade", result: "L", snapshotStatus: "FINAL_PREGAME" }),
    under({ date: "2026-10-04", game: "IND @ WAS", selection: "Over 46.5", tier: "Public Fade", snapshotStatus: "FINAL_PREGAME" }),
    under({ date: "2026-10-04", game: "LAR @ PHI", selection: "Under 42.5", tier: "RLM", snapshotStatus: "FINAL_PREGAME" }),
  ];
  assert.equal(records(rows, today).last7Days.record, "1-4-0");
});

test("post-effective LIVE picks are excluded until the final pregame decision is persisted", () => {
  const summary = records([falcons({ snapshotStatus: "LIVE" })], today);
  assert.equal(summary.last7Days.totalBets, 0);
  assert.equal(summary.history.length, 0);
});

test("unqualified picks cannot enter records just because they have a settled result", () => {
  for (const overrides of [
    { tier: "Sharp" }, { tier: "Public Fade" }, { tier: "RLM" },
    { odds: "-151" }, { qualified: false }, { ezpzEligible: false },
    { snapshotStatus: "REJECTED" }, { source: "Best Play" },
  ]) assert.equal(records([falcons(overrides)], today).last7Days.totalBets, 0);
});

test("legacy Strong and Regular yardage history remains, obsolete A/B and Lean do not", () => {
  const prop = falcons({ date: "2026-09-30", market: "Player Prop", source: "Best Play", playerName: "Player One", propMarket: "Receiving Yards", selection: "Under 40.5", tier: "Strong", snapshotStatus: "FINAL", odds: "+120" });
  const summary = records([prop, { ...prop }, { ...prop, playerName: "Player Two", tier: "Regular", result: "P" }, { ...prop, playerName: "Player Three", tier: "A Prop" }, { ...prop, playerName: "Player Four", tier: "Lean" }], today);
  assert.equal(summary.last7Days.record, "1-0-1");
  assert.equal(summary.last7Days.unitsWon, 1.2);
  assert.equal(summary.last7Days.winPct, 100);
  assert.equal(summary.last7Days.roiPct, 60);
});
