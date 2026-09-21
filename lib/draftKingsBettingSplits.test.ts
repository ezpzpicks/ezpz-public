import assert from "node:assert/strict";
import test from "node:test";

import {
  assessDraftKingsMarketCoverage,
  crawlDraftKingsFootballFilter,
  discoverDraftKingsFootballFilters,
  type DraftKingsFilterCandidate,
} from "./draftKingsBettingSplits.ts";

test("discovers the current numeric NFL event-group and widest page date range", () => {
  const html = `
    <select name="tb_eg">
      <option value="0">All sports</option>
      <option value="94682">NFL</option>
      <option value="88808">NCAA Football</option>
    </select>
    <select name="tb_edate">
      <option value="today">Today</option>
      <option value="n7days">Next 7 days</option>
      <option value="n30days">Next 30 days</option>
    </select>
  `;
  const result = discoverDraftKingsFootballFilters(html, "NFL");
  assert.deepEqual(result.candidates[0], {
    eventGroup: "94682",
    content: "94682",
    dateRange: "n30days",
    label: "NFL",
    source: "option",
  });
});

test("uses both live DK query parameters when the page exposes a label filter", () => {
  const html = `
    <select name="tb_edate"><option value="n30days">Next 30 days</option></select>
    <a href="/draftkings-sportsbook-betting-splits/?itm_content=NFL&amp;tb_edate=n30days&amp;tb_eg=NFL">NFL</a>
  `;
  const [candidate] = discoverDraftKingsFootballFilters(html, "NFL").candidates;
  assert.equal(candidate.eventGroup, "NFL");
  assert.equal(candidate.content, "NFL");
  assert.equal(candidate.dateRange, "n30days");
  assert.equal(candidate.source, "link");
});

test("fails closed instead of reusing a stale hard-coded NFL group", () => {
  assert.throws(
    () => discoverDraftKingsFootballFilters("<select><option>MLB</option></select>", "NFL"),
    /event-group discovery failed/,
  );
});

test("continues past an empty first page and de-duplicates a clamped final page", async () => {
  type Row = { id: string };
  const requested: Array<Record<string, string>> = [];
  const filter: DraftKingsFilterCandidate = {
    eventGroup: "NFL",
    content: "NFL",
    dateRange: "n30days",
    label: "NFL",
    source: "link",
  };
  const result = await crawlDraftKingsFootballFilter<Row>(
    filter,
    (html) => html === "COLTS" ? [{ id: "colts-chiefs" }] : html === "RAMS" ? [{ id: "giants-rams" }] : [],
    (row) => row.id,
    10,
    async (params) => {
      requested.push(params);
      if (!params.tb_page) return "Unable to fetch data from server. 403";
      if (params.tb_page === "1") return "";
      if (params.tb_page === "2") return "COLTS";
      return "RAMS";
    },
  );

  assert.deepEqual(result.rows, [{ id: "colts-chiefs" }, { id: "giants-rams" }]);
  assert.deepEqual(result.pagesWithRows, [2, 3]);
  assert.equal(result.pagesScanned, 4);
  assert.match(result.errors[0], /page 1.*403/);
  assert.deepEqual(requested[2], {
    itm_content: "NFL",
    tb_eg: "NFL",
    tb_edate: "n30days",
    tb_page: "2",
  });
});

test("uses the filtered URL without tb_page for a working first page", async () => {
  const filter: DraftKingsFilterCandidate = {
    eventGroup: "NFL",
    content: "NFL",
    dateRange: "n30days",
    label: "NFL",
    source: "link",
  };
  const requested: Array<Record<string, string>> = [];
  await crawlDraftKingsFootballFilter(
    filter,
    (html) => html === "FIRST" ? [{ id: "first-page" }] : [],
    (row) => row.id,
    1,
    async (params) => {
      requested.push(params);
      return "FIRST";
    },
  );
  assert.deepEqual(requested, [{
    itm_content: "NFL",
    tb_eg: "NFL",
    tb_edate: "n30days",
  }]);
});

test("rejects a plausible-looking but partial NFL slate", () => {
  type Row = { game: string; market: "Spread" | "Total"; side: string };
  const expected = new Map([
    ["colts-chiefs", "IND Colts @ KC Chiefs"],
    ["giants-rams", "NY Giants @ LA Rams"],
  ]);
  const coltsOnly: Row[] = [
    { game: "colts-chiefs", market: "Spread", side: "KC" },
    { game: "colts-chiefs", market: "Spread", side: "IND" },
    { game: "colts-chiefs", market: "Total", side: "Over" },
    { game: "colts-chiefs", market: "Total", side: "Under" },
  ];
  const partial = assessDraftKingsMarketCoverage(
    expected,
    coltsOnly,
    (row) => row.game,
    (row) => row.market,
    (row) => row.side,
  );
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.missingGames, ["NY Giants @ LA Rams"]);

  const completeRows: Row[] = [
    ...coltsOnly,
    { game: "giants-rams", market: "Spread", side: "LAR" },
    { game: "giants-rams", market: "Spread", side: "NYG" },
    { game: "giants-rams", market: "Total", side: "Over" },
    { game: "giants-rams", market: "Total", side: "Under" },
  ];
  const complete = assessDraftKingsMarketCoverage(
    expected,
    completeRows,
    (row) => row.game,
    (row) => row.market,
    (row) => row.side,
  );
  assert.equal(complete.ok, true);
  assert.equal(complete.receivedGames, 2);
});

test("does not call an empty canonical slate complete", () => {
  const coverage = assessDraftKingsMarketCoverage(
    new Map<string, string>(),
    [],
    () => "",
    () => "Spread",
    () => "",
  );
  assert.equal(coverage.ok, false);
  assert.equal(coverage.expectedGames, 0);
});
