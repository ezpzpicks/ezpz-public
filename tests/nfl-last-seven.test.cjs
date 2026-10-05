const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../app/FootballBoard.tsx"), "utf8");
const api = {};
const element = (type, props) => ({ type, props });
vm.runInNewContext(ts.transpileModule(source + "\nexports.record = directTrendRecord; exports.card = HistoryPickCard;", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText, {
  exports: api,
  require: name => name === "react/jsx-runtime" ? { jsx: element, jsxs: element } : {},
});

function row(day, result, overrides = {}) {
  return {
    Date: `2026-09-${String(day).padStart(2, "0")}`,
    Game: `Visitor${day} @ Host${day}`, "Game Time": "1:00 PM",
    Market: "Spread", Selection: `Visitor${day}`, "Public Split Line": "3.5",
    "Public Bets %": "45", "Public Money %": "55", "Opening Sharp %": "35",
    "Sharp Change %": "20", "Line Movement Basis": "Spread Line", "Line Movement Value": "1",
    "Public Split Odds": "-110", Result: result, "Result Source": "schedule final",
    ...overrides,
  };
}
function total(day, result, side = "Under", overrides = {}) {
  return row(day, result, { Market: "Total", Selection: side, Side: side,
    "Public Split Line": "44.5", "Line Movement Basis": "Total Line", ...overrides });
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return text(node.props?.children);
}
const cutoff = "2026-10-05";

test("Money Momentum Underdog card includes qualifying bets even when a combined total outranks them", () => {
  const outcomes = ["W", "L", "W", "W", "P", "L", "W", "L"];
  const rows = outcomes.flatMap((result, index) => [row(28 - index, result), total(28 - index, "W")]);
  rows.push(row(29, "L", { "Public Split Line": "-3.5" })); // Favorite: exclude.
  rows.push(row(30, "Pending"));
  const pick = { date: cutoff, game: "ATL @ NO", market: "Spread", selection: "ATL +1.5", source: "Trend Play", tier: "Spread Money Momentum", qualification: "Spread Money Momentum • market moved 1.0 pts toward the pick" };
  const card = text(api.card({ pick, sport: "NFL", viewingToday: true, data: { today: cutoff, trendRecordRows: rows, aiPickRecordRows: [] } }));
  assert.match(card, /Money Momentum Underdog Record/);
  assert.match(card, /L7\s+4-2-1/);
  assert.doesNotMatch(card, /Exact EZPZ/);
  assert.doesNotMatch(card, /Market Move/);
});

test("Market Move Under excludes Over results and counts each distinct game", () => {
  const rows = [total(28, "W"), total(28, "W", "Under", { Game: "Other visitor @ Other host" }), total(29, "L", "Over")];
  const record = api.record(rows, "NFL", "Market Move", "Under", cutoff);
  assert.equal(record.totalBets, 2);
  assert.match(record.record, /^2-0(?:-0)?$/);
});

test("same-day results are ordered by game time before taking seven", () => {
  const rows = Array.from({ length: 7 }, (_, i) => total(28, "W", "Under", { Game: `Early${i} @ Opponent${i}`, "Game Time": "1:00 PM" }));
  rows.push(total(28, "L", "Under", { Game: "Late visitor @ Late host", "Game Time": "8:20 PM" }));
  assert.match(api.record(rows, "NFL", "Market Move", "Under", cutoff).record, /^6-1(?:-0)?$/);
});

test("an obsolete abbreviated duplicate cannot turn an official favorite into an underdog", () => {
  const rows = [
    row(27, "W", { Game: "LAR @ DEN", Selection: "DEN", "Public Split Line": "1.5", "Result Source": "bet_tracker exact fallback" }),
    row(27, "W", { Game: "Los Angeles Rams @ Denver Broncos", Selection: "Denver Broncos", "Public Split Line": "-1.5" }),
  ];
  assert.equal(api.record(rows, "NFL", "Money Momentum", "Underdog", cutoff).totalBets, 0);
  assert.equal(api.record(rows, "NFL", "Money Momentum", "Favorite", cutoff).totalBets, 1);
});

test("a combined total card shows separate signal-and-direction records", () => {
  const rows = [total(28, "W"), total(27, "L", "Under", { "Sharp Change %": "0" })];
  const pick = { date: cutoff, game: "ATL @ NO", market: "Total", selection: "Under 47.5", source: "Trend Play", tier: "Market Move + Total Money Momentum" };
  const card = text(api.card({ pick, sport: "NFL", viewingToday: true, data: { today: cutoff, trendRecordRows: rows } }));
  assert.match(card, /Market Move Under Record/);
  assert.match(card, /Money Momentum Under Record/);
  assert.match(card, /L7\s+1-1/);
  assert.match(card, /L7\s+1-0/);
});
