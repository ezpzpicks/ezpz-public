export type ScoresAndOddsSport = "MLB" | "NFL" | "NCAAF" | "NCAAB" | "NBA" | "NHL";

export type ScoresAndOddsMarketSplit = {
  date: string;
  eventTime: string;
  game: string;
  awayTeam: string;
  homeTeam: string;
  market: "Moneyline" | "Spread" | "Run Line" | "Total";
  selection: string;
  selectionTeam: string;
  side: "Over" | "Under" | "";
  line: number | null;
  odds: string;
  moneyPct: number;
  betsPct: number;
  sourceUrl: string;
};

export const SCORES_AND_ODDS_SOURCE = "ScoresAndOdds";
export const SCORES_AND_ODDS_BASE_URL = "https://www.scoresandodds.com";

const SPORT_SLUG: Record<ScoresAndOddsSport, string> = {
  MLB: "mlb",
  NFL: "nfl",
  NCAAF: "ncaaf",
  NCAAB: "ncaab",
  NBA: "nba",
  NHL: "nhl",
};

const EMPTY = "__SAO_EMPTY__";
const ALT = "__SAO_ALT__";

export function scoresAndOddsConsensusUrl(sport: ScoresAndOddsSport) {
  return `${SCORES_AND_ODDS_BASE_URL}/${SPORT_SLUG[sport]}/consensus-picks`;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTagsToTokens(rawHtml: string) {
  const withAltMarkers = String(rawHtml || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_match, doubleQuoted, singleQuoted) => {
      const alt = decodeHtmlEntities(String(doubleQuoted || singleQuoted || "")).trim();
      return alt ? `\n${ALT}${alt}\n` : "\n";
    })
    // ScoresAndOdds renders suppressed tiny shares as a non-breaking-space cell.
    // Preserve that empty cell so 91% / blank can be reconstructed as 91% / 9%.
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ` ${EMPTY} `)
    .replace(/<[^>]+>/g, "\n");

  return decodeHtmlEntities(withAltMarkers)
    .split(/\r?\n/)
    .map((item) => item.replace(/[\t\r]+/g, " ").replace(/ {2,}/g, " ").trim())
    .filter(Boolean);
}

function cleanAltToken(value: string) {
  return value.startsWith(ALT) ? value.slice(ALT.length).trim() : "";
}

function isNoiseTeamToken(value: string) {
  const text = value.trim();
  if (!text) return true;
  const key = text.toLowerCase();
  return (
    key.includes("sportsbook") ||
    key.includes("scoresandodds") ||
    key.includes("scores and odds") ||
    key.includes("logo") ||
    key === "arrow" ||
    key === "chevron"
  );
}

function teamsBeforeAnchor(tokens: string[], anchor: number) {
  const alts: string[] = [];
  for (let index = Math.max(0, anchor - 20); index < anchor; index += 1) {
    const alt = cleanAltToken(tokens[index] || "");
    if (!alt || isNoiseTeamToken(alt)) continue;
    if (!alts.length || alts[alts.length - 1] !== alt) alts.push(alt);
  }
  if (alts.length >= 2) return [alts[alts.length - 2], alts[alts.length - 1]] as const;

  const candidates: string[] = [];
  for (let index = Math.max(0, anchor - 10); index < anchor; index += 1) {
    const raw = String(tokens[index] || "").trim();
    if (
      !raw ||
      raw.includes("%") ||
      /best\s+(?:away|home|over|under)/i.test(raw) ||
      /odds/i.test(raw) ||
      /[<>›]/.test(raw) ||
      /\d/.test(raw) ||
      raw.startsWith(ALT) ||
      raw.includes(EMPTY)
    ) continue;
    if (!candidates.length || candidates[candidates.length - 1] !== raw) candidates.push(raw);
  }
  return candidates.length >= 2
    ? [candidates[candidates.length - 2], candidates[candidates.length - 1]] as const
    : ["", ""] as const;
}

function percentSlotsAroundAnchor(tokens: string[], anchor: number) {
  const slots: Array<number | null> = [];
  for (let index = anchor; index < Math.min(tokens.length, anchor + 16); index += 1) {
    const raw = String(tokens[index] || "");
    const beforeMoneyLabel = raw.split(/%\s*of\s*Money/i)[0] || "";
    const matches = beforeMoneyLabel.match(new RegExp(`${EMPTY}|\\d{1,3}(?:\\.\\d+)?%`, "g")) || [];
    for (const match of matches) {
      if (match === EMPTY) slots.push(null);
      else {
        const parsed = Number(match.replace("%", ""));
        if (Number.isFinite(parsed)) slots.push(Math.max(0, Math.min(100, parsed)));
      }
    }
    if (/%\s*of\s*Money/i.test(raw)) break;
  }

  // Nested markup can occasionally repeat the same blank marker. The actual
  // consensus grid always represents exactly four cells: away/over bets,
  // home/under bets, away/over money, home/under money.
  while (slots.length > 4 && slots[0] == null && slots[1] == null) slots.shift();
  while (slots.length > 4 && slots[slots.length - 1] == null && slots[slots.length - 2] == null) slots.pop();
  return slots.slice(0, 4);
}

function approximatelyHundred(left: number, right: number) {
  return Math.abs(left + right - 100) <= 1.1;
}

function fillPair(left: number | null, right: number | null): [number, number] | null {
  if (left != null && right != null) {
    if (!approximatelyHundred(left, right)) return null;
    return [left, right];
  }
  if (left != null) return [left, Math.max(0, Math.min(100, 100 - left))];
  if (right != null) return [Math.max(0, Math.min(100, 100 - right)), right];
  return null;
}

function resolvePercentages(rawSlots: Array<number | null>) {
  if (rawSlots.length === 4) {
    const bets = fillPair(rawSlots[0], rawSlots[1]);
    const money = fillPair(rawSlots[2], rawSlots[3]);
    if (bets && money) return { bets, money };
  }

  const numeric = rawSlots.filter((value): value is number => value != null);
  if (numeric.length === 4) {
    const bets = fillPair(numeric[0], numeric[1]);
    const money = fillPair(numeric[2], numeric[3]);
    if (bets && money) return { bets, money };
  }

  // Fallback for HTML renderers that discard the explicit blank cell. A
  // three-number row is recoverable when one adjacent pair already sums to 100;
  // assign the lone high/low value to the side whose ticket share is closest.
  if (numeric.length === 3 && approximatelyHundred(numeric[0], numeric[1])) {
    const bets: [number, number] = [numeric[0], numeric[1]];
    const visibleMoney = numeric[2];
    const leftDistance = Math.abs(bets[0] - visibleMoney);
    const rightDistance = Math.abs(bets[1] - visibleMoney);
    const money: [number, number] = leftDistance <= rightDistance
      ? [visibleMoney, 100 - visibleMoney]
      : [100 - visibleMoney, visibleMoney];
    return { bets, money };
  }
  if (numeric.length === 3 && approximatelyHundred(numeric[1], numeric[2])) {
    const money: [number, number] = [numeric[1], numeric[2]];
    const visibleBets = numeric[0];
    const leftDistance = Math.abs(money[0] - visibleBets);
    const rightDistance = Math.abs(money[1] - visibleBets);
    const bets: [number, number] = leftDistance <= rightDistance
      ? [visibleBets, 100 - visibleBets]
      : [100 - visibleBets, visibleBets];
    return { bets, money };
  }

  return null;
}

function headerAroundAnchor(tokens: string[], anchor: number) {
  const pieces: string[] = [];
  for (let index = Math.max(0, anchor - 4); index < Math.min(tokens.length, anchor + 8); index += 1) {
    const raw = String(tokens[index] || "").trim();
    if (!raw || raw.startsWith(ALT) || raw.includes(EMPTY)) continue;
    pieces.push(raw);
    if (/%\s*of\s*Money/i.test(raw)) break;
    if (/\d{1,3}(?:\.\d+)?%/.test(raw) && index > anchor + 1) {
      // Keep the percentages out of market/line parsing; they are handled above.
      break;
    }
  }
  return pieces.join(" ");
}

function marketFromHeader(header: string, sport: ScoresAndOddsSport) {
  if (/\bover\b/i.test(header) && /\bunder\b/i.test(header)) return "Total" as const;
  if (/\([+-]?\d+(?:\.\d+)?\)/.test(header)) {
    return sport === "MLB" ? "Run Line" as const : "Spread" as const;
  }
  return "Moneyline" as const;
}

function parsePairedLines(header: string, market: ScoresAndOddsMarketSplit["market"]) {
  if (market === "Total") {
    const values = [...header.matchAll(/\([ou]\s*([0-9]+(?:\.\d+)?)\)/gi)]
      .map((match) => Number(match[1]))
      .filter(Number.isFinite);
    if (values.length >= 2) return [values[0], values[1]] as const;
    if (values.length === 1) return [values[0], values[0]] as const;
    return [null, null] as const;
  }

  if (market === "Spread" || market === "Run Line") {
    const values = [...header.matchAll(/\(([+-]?\d+(?:\.\d+)?)\)/g)]
      .map((match) => Number(match[1]))
      .filter(Number.isFinite);
    if (values.length >= 2) return [values[0], values[1]] as const;
    if (values.length === 1) return [values[0], -values[0]] as const;
  }
  return [null, null] as const;
}

function americanOddsFromText(value: string) {
  const normalized = String(value || "").replace(/[−–—]/g, "-");
  if (/\beven\b/i.test(normalized)) return "+100";
  const matches = normalized.match(/[+-]\d{3,4}\b/g);
  return matches?.length ? matches[matches.length - 1] : "";
}

function findBestOdds(tokens: string[], anchor: number, label: RegExp) {
  const stop = Math.min(tokens.length, anchor + 28);
  for (let index = anchor; index < stop; index += 1) {
    const raw = String(tokens[index] || "");
    if (index > anchor && /%\s*of\s*Bets/i.test(raw)) break;
    if (!label.test(raw)) continue;
    for (let probe = index + 1; probe < Math.min(stop, index + 7); probe += 1) {
      const odds = americanOddsFromText(tokens[probe] || "");
      if (odds) return odds;
    }
  }
  return "";
}

function cleanSelectionTeam(value: string) {
  return String(value || "")
    .replace(/\s*\([+-]?\d+(?:\.\d+)?\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptorSelections(tokens: string[], anchor: number) {
  const anchorText = String(tokens[anchor] || "");
  const split = anchorText.split(/%\s*of\s*Bets/i);
  let left = String(split[0] || "").trim();
  let right = String(split[1] || "").replace(/\d{1,3}(?:\.\d+)?%.*$/, "").trim();

  if (!left) {
    for (let index = anchor - 1; index >= Math.max(0, anchor - 4); index -= 1) {
      const raw = String(tokens[index] || "").trim();
      if (!raw || raw.startsWith(ALT) || raw.includes(EMPTY)) continue;
      left = raw;
      break;
    }
  }

  if (!right) {
    for (let index = anchor + 1; index < Math.min(tokens.length, anchor + 5); index += 1) {
      const raw = String(tokens[index] || "").trim();
      if (!raw || raw.startsWith(ALT) || raw.includes(EMPTY) || /^\d{1,3}(?:\.\d+)?%$/.test(raw)) continue;
      if (/%\s*of\s*Money/i.test(raw)) break;
      right = raw.replace(/\d{1,3}(?:\.\d+)?%.*$/, "").trim();
      if (right) break;
    }
  }
  return { left, right };
}

function dateFromPage(rawHtml: string) {
  const monthNames = "January|February|March|April|May|June|July|August|September|October|November|December";
  const match = decodeHtmlEntities(rawHtml).match(
    new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?,\\s+(20\\d{2})\\b`, "i"),
  );
  if (!match) return "";
  const month = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ].indexOf(match[1].toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

export function parseScoresAndOddsConsensus(
  rawHtml: string,
  sport: ScoresAndOddsSport,
): ScoresAndOddsMarketSplit[] {
  const tokens = stripTagsToTokens(rawHtml);
  const sourceUrl = scoresAndOddsConsensusUrl(sport);
  const pageDate = dateFromPage(rawHtml);
  const rows: ScoresAndOddsMarketSplit[] = [];

  for (let anchor = 0; anchor < tokens.length; anchor += 1) {
    if (!/%\s*of\s*Bets/i.test(tokens[anchor] || "")) continue;

    const percentages = resolvePercentages(percentSlotsAroundAnchor(tokens, anchor));
    if (!percentages) continue;

    const [contextAway, contextHome] = teamsBeforeAnchor(tokens, anchor);
    const descriptor = descriptorSelections(tokens, anchor);
    const header = headerAroundAnchor(tokens, anchor);
    const market = marketFromHeader(header, sport);

    const awayTeam = contextAway || (market === "Total" ? "" : cleanSelectionTeam(descriptor.left));
    const homeTeam = contextHome || (market === "Total" ? "" : cleanSelectionTeam(descriptor.right));
    if (!awayTeam || !homeTeam || awayTeam === homeTeam) continue;

    const [leftLine, rightLine] = parsePairedLines(header, market);
    const leftOdds = findBestOdds(
      tokens,
      anchor,
      market === "Total" ? /best\s+over/i : /best\s+away\s+odds/i,
    );
    const rightOdds = findBestOdds(
      tokens,
      anchor,
      market === "Total" ? /best\s+under/i : /best\s+home\s+odds/i,
    );

    const leftSide = market === "Total" ? "Over" as const : "" as const;
    const rightSide = market === "Total" ? "Under" as const : "" as const;
    const leftTeam = market === "Total" ? "" : awayTeam;
    const rightTeam = market === "Total" ? "" : homeTeam;
    const leftSelection = market === "Total"
      ? `Over ${leftLine ?? ""}`.trim()
      : leftLine == null
        ? awayTeam
        : `${awayTeam} ${leftLine > 0 ? "+" : ""}${leftLine}`;
    const rightSelection = market === "Total"
      ? `Under ${rightLine ?? leftLine ?? ""}`.trim()
      : rightLine == null
        ? homeTeam
        : `${homeTeam} ${rightLine > 0 ? "+" : ""}${rightLine}`;

    rows.push({
      date: pageDate,
      eventTime: "",
      game: `${awayTeam} @ ${homeTeam}`,
      awayTeam,
      homeTeam,
      market,
      selection: leftSelection,
      selectionTeam: leftTeam,
      side: leftSide,
      line: leftLine,
      odds: leftOdds,
      moneyPct: percentages.money[0],
      betsPct: percentages.bets[0],
      sourceUrl,
    });
    rows.push({
      date: pageDate,
      eventTime: "",
      game: `${awayTeam} @ ${homeTeam}`,
      awayTeam,
      homeTeam,
      market,
      selection: rightSelection,
      selectionTeam: rightTeam,
      side: rightSide,
      line: rightLine ?? leftLine,
      odds: rightOdds,
      moneyPct: percentages.money[1],
      betsPct: percentages.bets[1],
      sourceUrl,
    });
  }

  const deduped = new Map<string, ScoresAndOddsMarketSplit>();
  for (const row of rows) {
    const key = [
      row.game.toLowerCase(),
      row.market,
      (row.market === "Total" ? row.side : row.selectionTeam).toLowerCase(),
    ].join("|");
    deduped.set(key, row);
  }
  return [...deduped.values()];
}

export async function fetchScoresAndOddsConsensusHtml(sport: ScoresAndOddsSport) {
  const url = scoresAndOddsConsensusUrl(sport);
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: SCORES_AND_ODDS_BASE_URL + "/",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`ScoresAndOdds ${sport} consensus request failed: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  if (!/%\s*of\s*Bets/i.test(decodeHtmlEntities(html)) && !/no games scheduled/i.test(decodeHtmlEntities(html))) {
    throw new Error(`ScoresAndOdds ${sport} consensus page returned no recognizable consensus content.`);
  }
  return { url, html };
}

export async function loadScoresAndOddsConsensus(sport: ScoresAndOddsSport) {
  const fetched = await fetchScoresAndOddsConsensusHtml(sport);
  return {
    ...fetched,
    splits: parseScoresAndOddsConsensus(fetched.html, sport),
  };
}
