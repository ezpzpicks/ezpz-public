export type DraftKingsFootballSport = "NFL" | "NCAAF";

export const DK_BETTING_SPLITS_URL =
  "https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/";

export type DraftKingsFilterCandidate = {
  eventGroup: string;
  content: string;
  dateRange: string;
  label: string;
  source: "link" | "selected-option" | "option";
};

export type DraftKingsFilterDiscovery = {
  candidates: DraftKingsFilterCandidate[];
  dateRanges: string[];
};

export type DraftKingsPageCrawl<T> = {
  rows: T[];
  filter: DraftKingsFilterCandidate;
  pagesScanned: number;
  pagesWithRows: number[];
  errors: string[];
};

export type DraftKingsMarketCoverage = {
  ok: boolean;
  expectedGames: number;
  receivedGames: number;
  missingGames: string[];
  incompleteGames: string[];
};

export function assessDraftKingsMarketCoverage<T>(
  expected: Map<string, string>,
  rows: T[],
  gameKey: (row: T) => string,
  market: (row: T) => "Spread" | "Total",
  sideKey: (row: T) => string,
): DraftKingsMarketCoverage {
  const received = new Map<string, { spread: Set<string>; total: Set<string> }>();
  for (const row of rows) {
    const key = gameKey(row);
    const side = sideKey(row);
    if (!key || !side) continue;
    const state = received.get(key) || { spread: new Set<string>(), total: new Set<string>() };
    if (market(row) === "Spread") state.spread.add(side);
    else state.total.add(side);
    received.set(key, state);
  }

  const missingGames: string[] = [];
  const incompleteGames: string[] = [];
  for (const [key, label] of expected) {
    const state = received.get(key);
    if (!state) {
      missingGames.push(label);
      continue;
    }
    const spreadPublished = state.spread.size > 0;
    const totalPublished = state.total.size > 0;
    const spreadIncomplete = spreadPublished && state.spread.size < 2;
    const totalIncomplete = totalPublished && state.total.size < 2;
    if ((!spreadPublished && !totalPublished) || spreadIncomplete || totalIncomplete) {
      incompleteGames.push(
        `${label} (${state.spread.size}/2 spread sides, ${state.total.size}/2 total sides)`,
      );
    }
  }
  return {
    // A collector cannot prove completeness without at least one canonical
    // pregame matchup to compare against. Fail closed instead of treating an
    // empty schedule and an empty DK response as a successful full slate.
    ok: expected.size > 0 && missingGames.length === 0 && incompleteGames.length === 0,
    expectedGames: expected.size,
    receivedGames: received.size,
    missingGames,
    incompleteGames,
  };
}

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function textKey(value: unknown) {
  return decodeHtml(String(value || ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function attributeValue(attributes: string, name: string) {
  const quoted = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  if (quoted) return decodeHtml(quoted[2]).trim();
  const bare = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"),
  );
  return bare ? decodeHtml(bare[1]).trim() : "";
}

function isSportLabel(value: unknown, sport: DraftKingsFootballSport) {
  const key = textKey(value);
  if (sport === "NFL") {
    return key === "nfl" || key === "national football league" || key === "nfl regular season";
  }
  return ["ncaaf", "ncaa football", "college football"].includes(key);
}

function dateRangeDays(value: string) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "today") return 1;
  const match = key.match(/^n(\d+)days$/);
  return match ? Number(match[1]) : 0;
}

function preferredDateRange(values: string[]) {
  const usable = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .map((value) => ({ value, days: dateRangeDays(value) }))
    .filter((item) => item.days > 0 && item.days <= 45)
    .sort((left, right) => right.days - left.days);
  return usable[0]?.value || "n30days";
}

function selectOptions(rawHtml: string) {
  const rows: Array<{
    selectName: string;
    label: string;
    value: string;
    selected: boolean;
  }> = [];
  const selectPattern = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  for (const select of rawHtml.matchAll(selectPattern)) {
    const attributes = select[1] || "";
    const selectName =
      attributeValue(attributes, "name") ||
      attributeValue(attributes, "id") ||
      attributeValue(attributes, "class");
    const optionPattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    for (const option of (select[2] || "").matchAll(optionPattern)) {
      const optionAttributes = option[1] || "";
      rows.push({
        selectName,
        label: visibleText(option[2] || ""),
        value: attributeValue(optionAttributes, "value"),
        selected: /\bselected(?:\s*=|\s|>|$)/i.test(optionAttributes),
      });
    }
  }
  return rows;
}

function filterLinks(rawHtml: string) {
  const rows: Array<{ label: string; href: string }> = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const anchor of rawHtml.matchAll(anchorPattern)) {
    const href = attributeValue(anchor[1] || "", "href");
    if (!href || !/(?:^|[?&])(?:tb_eg|itm_content)=/i.test(decodeHtml(href))) continue;
    rows.push({ label: visibleText(anchor[2] || ""), href });
  }
  return rows;
}

export function discoverDraftKingsFootballFilters(
  rawHtml: string,
  sport: DraftKingsFootballSport,
): DraftKingsFilterDiscovery {
  const options = selectOptions(rawHtml);
  const dateRanges = options
    .filter((option) => /tb[_-]?edate|date.*range/i.test(option.selectName))
    .map((option) => option.value)
    .filter(Boolean);
  const defaultDateRange = preferredDateRange(dateRanges);
  const ranked: Array<{ priority: number; candidate: DraftKingsFilterCandidate }> = [];

  for (const link of filterLinks(rawHtml)) {
    let url: URL;
    try {
      url = new URL(decodeHtml(link.href), DK_BETTING_SPLITS_URL);
    } catch {
      continue;
    }
    const eventGroup = String(url.searchParams.get("tb_eg") || "").trim();
    const content = String(url.searchParams.get("itm_content") || eventGroup).trim();
    if (!eventGroup) continue;
    if (
      !isSportLabel(link.label, sport) &&
      !isSportLabel(eventGroup, sport) &&
      !isSportLabel(content, sport)
    ) continue;
    ranked.push({
      priority: 0,
      candidate: {
        eventGroup,
        content,
        dateRange: preferredDateRange([
          defaultDateRange,
          String(url.searchParams.get("tb_edate") || ""),
        ]),
        label: link.label || (sport === "NFL" ? "NFL" : "NCAA Football"),
        source: "link",
      },
    });
  }

  for (const option of options) {
    if (!isSportLabel(option.label, sport) || !option.value) continue;
    ranked.push({
      priority: option.selected ? 1 : 2,
      candidate: {
        eventGroup: option.value,
        content: option.value,
        dateRange: defaultDateRange,
        label: option.label,
        source: option.selected ? "selected-option" : "option",
      },
    });
  }

  // Some DK builds render the filter links as escaped JSON instead of anchors.
  // Resolve those URLs too, but only when the same snippet identifies the sport.
  const queryPattern = /(?:https?:\\?\/\\?\/[^"'\s<>]+)?[?&](?:amp;)?itm_content=([^&"'\s<>]+)[^"'\s<>]{0,300}?[&](?:amp;)?tb_eg=([^&"'\s<>]+)/gi;
  for (const match of rawHtml.matchAll(queryPattern)) {
    const snippetStart = Math.max(0, Number(match.index || 0) - 160);
    const snippet = rawHtml.slice(snippetStart, Number(match.index || 0) + match[0].length + 160);
    const content = safeDecodeURIComponent(decodeHtml(match[1]).replace(/\\/g, ""));
    const eventGroup = safeDecodeURIComponent(decodeHtml(match[2]).replace(/\\/g, ""));
    if (
      !isSportLabel(content, sport) &&
      !isSportLabel(eventGroup, sport) &&
      !isSportLabel(visibleText(snippet), sport)
    ) continue;
    ranked.push({
      priority: 3,
      candidate: {
        eventGroup,
        content: content || eventGroup,
        dateRange: defaultDateRange,
        label: sport === "NFL" ? "NFL" : "NCAA Football",
        source: "link",
      },
    });
  }

  const candidates: DraftKingsFilterCandidate[] = [];
  const seen = new Set<string>();
  for (const item of ranked.sort((left, right) => left.priority - right.priority)) {
    const key = `${item.candidate.eventGroup}|${item.candidate.content}|${item.candidate.dateRange}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(item.candidate);
  }

  if (!candidates.length) {
    throw new Error(
      `DraftKings ${sport} event-group discovery failed; refusing to use a stale hard-coded filter.`,
    );
  }
  return { candidates, dateRanges: [...new Set(dateRanges)] };
}

export async function fetchDraftKingsBettingSplitsHtml(
  params: Record<string, string> = {},
) {
  const target = new URL(DK_BETTING_SPLITS_URL);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  const response = await fetch(target, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks/1.0; +https://ezpzpicks.com)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`DraftKings splits request failed ${response.status}`);
  }
  return response.text();
}

export async function loadDraftKingsFootballFilterCandidates(
  sport: DraftKingsFootballSport,
) {
  const rootHtml = await fetchDraftKingsBettingSplitsHtml();
  return discoverDraftKingsFootballFilters(rootHtml, sport);
}

function embeddedPageError(rawHtml: string) {
  const match = visibleText(rawHtml).match(
    /Unable to fetch data from server(?:\.\s*)?(\d{3})?/i,
  );
  return match ? `DraftKings page reported upstream ${match[1] || "fetch"} failure` : "";
}

export async function crawlDraftKingsFootballFilter<T>(
  filter: DraftKingsFilterCandidate,
  parsePage: (rawHtml: string) => T[],
  rowKey: (row: T) => string,
  maxPages = 25,
  fetchPage: (params: Record<string, string>) => Promise<string> =
    fetchDraftKingsBettingSplitsHtml,
): Promise<DraftKingsPageCrawl<T>> {
  const map = new Map<string, T>();
  const errors: string[] = [];
  const pagesWithRows: number[] = [];
  const seenPageSignatures = new Set<string>();
  let consecutiveEmptyPages = 0;
  let pagesScanned = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    pagesScanned = page;
    let parsed: T[] = [];
    const baseParams = {
        itm_content: filter.content,
        tb_eg: filter.eventGroup,
        tb_edate: filter.dateRange,
    };
    // DK intermittently returns an embedded 403 for explicit tb_page=1 while
    // serving the same first filtered page when the page parameter is omitted.
    // Try the canonical no-page URL first, then the explicit form as a fallback.
    const requests = page === 1
      ? [baseParams, { ...baseParams, tb_page: "1" }]
      : [{ ...baseParams, tb_page: String(page) }];
    for (const params of requests) {
      let rawHtml = "";
      try {
        rawHtml = await fetchPage(params);
      } catch (error) {
        errors.push(`page ${page}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      const upstreamError = embeddedPageError(rawHtml);
      if (upstreamError) errors.push(`page ${page}: ${upstreamError}`);
      parsed = parsePage(rawHtml);
      if (parsed.length) break;
    }
    if (!parsed.length) {
      // DK can serve an empty/403-backed page between valid pages. In particular,
      // page 1 may be empty while the still-live Sunday/Monday games are on page 2.
      consecutiveEmptyPages += 1;
      if (page >= 5 && consecutiveEmptyPages >= 3) break;
      continue;
    }

    consecutiveEmptyPages = 0;
    const signature = parsed.map(rowKey).filter(Boolean).sort().join("|");
    // Requests past the final DK page are clamped back to the last real page.
    if (signature && seenPageSignatures.has(signature)) break;
    if (signature) seenPageSignatures.add(signature);
    pagesWithRows.push(page);
    for (const row of parsed) {
      const key = rowKey(row);
      if (key) map.set(key, row);
    }
  }

  return {
    rows: [...map.values()],
    filter,
    pagesScanned,
    pagesWithRows,
    errors,
  };
}
