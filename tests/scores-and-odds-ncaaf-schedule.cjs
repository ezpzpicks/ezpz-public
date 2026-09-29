const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

function loadModule(file, imports = {}, extra = "") {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8") + extra;
  const context = {
    exports: {}, Date, Intl, Map, Set, AbortSignal, console,
    require: (name) => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}

const parser = loadModule("lib/scoresAndOddsBettingSplits.ts");
const title = "<title>NCAAF Consensus Picks - September 29th, 2026</title>";

function card(away, home, clock, market = "Spread") {
  const left = market === "Total" ? "Over (o57.5)" : `${away} (+2.5)`;
  const right = market === "Total" ? "Under (u57.5)" : `${home} (-2.5)`;
  return `<div class="event-card consensus">
    <div class="event-header">
      <div><img alt="${away}"><span>${away}</span></div>
      <div class="event-info"><a href="/ncaaf/matchup">${clock}</a></div>
      <div><span>${home}</span><img alt="${home}"></div>
    </div>
    <div class="module-body">
      <span>${left}</span><span>% of Bets</span><span>${right}</span>
      <span>62%</span><span>38%</span><span>54%</span><span>46%</span>
      <span>% of Money</span>
    </div>
  </div>`;
}

function parse(html, sport = "NCAAF") {
  return parser.parseScoresAndOddsConsensus(title + html, sport);
}

test("weekly NCAAF games use their ISO kickoff, including UTC date rollover", () => {
  const html = ["Spread", "Total"].map((market) => card(
    "Western Kentucky", "New Mexico State",
    '<span data-role="localtime" data-value="2026-10-02T00:00:00Z"></span>', market,
  )).join("");
  const rows = parse(html);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.date, "2026-10-01");
    assert.equal(row.eventTime, "20:00");
  }
});

test("ISO attributes take precedence over stale visible text and support EST", () => {
  const rows = parse(card("Army", "Navy",
    "<span data-value='2026-12-12T20:00:00Z' data-role='localtime'>12/12 12:00 PM</span>"));
  assert.equal(rows[0].date, "2026-12-12");
  assert.equal(rows[0].eventTime, "15:00");
});

test("missing or invalid kickoffs never inherit another game's clock or the page date", () => {
  const rows = parse(
    card("Virginia", "Delaware", '<span data-role="localtime" data-value="2026-10-02T22:00:00Z"></span>') +
    card("Utah", "Iowa State", "TBD") +
    card("Kentucky", "South Alabama", '<span data-role="localtime" data-value="invalid"></span>'),
  );
  for (const row of rows.filter((row) => row.awayTeam !== "Virginia")) {
    assert.equal(row.date, "");
    assert.equal(row.eventTime, "");
  }
});

test("legacy visible UTC kickoff text still works within its event header", () => {
  const rows = parse(card("Virginia", "Delaware", "<span>10/02 10:00 PM</span>"));
  assert.equal(rows[0].date, "2026-10-02");
  assert.equal(rows[0].eventTime, "18:00");
});

test("NFL and MLB keep their existing date and time behavior", () => {
  for (const sport of ["NFL", "MLB"]) {
    const rows = parse(card("Away", "Home", '<span data-role="localtime" data-value="2026-10-02T00:00:00Z"></span>'), sport);
    assert.equal(rows[0].date, "2026-09-29");
    assert.equal(rows[0].eventTime, "");
  }
});

test("the public feed accepts upcoming games and retains its date-match guard", async () => {
  const rows = parse(card("Western Kentucky", "New Mexico State",
    '<span data-role="localtime" data-value="2026-10-02T00:00:00Z"></span>'));
  const core = loadModule("lib/footballPublicDataCore.ts", {
    "./sportSheets": {},
    "./footballWeeklyMarket": {},
    "./scoresAndOddsBettingSplits": {
      ...parser,
      loadScoresAndOddsConsensus: async () => ({ splits: rows }),
    },
  }, "\nexports.loadSplitsForTest = loadDraftKingsSplits;\n");
  const slate = [{ Date: "2026-10-01", "Game Time": "8:00 PM", "Away Team": "Western Kentucky", "Home Team": "New Mexico State" }];
  const result = await core.loadSplitsForTest("NCAAF", slate);
  assert.equal(result.splits.length, 2);
  assert.equal(result.coverage.receivedGames, 1);
  assert.equal(result.splits[0].eventTime, "20:00");
  await assert.rejects(
    core.loadSplitsForTest("NCAAF", [{ ...slate[0], Date: "2026-09-29" }]),
    /no NCAAF ScoresAndOdds market sides matched/,
  );
});
