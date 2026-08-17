import fs from "node:fs/promises";
import path from "node:path";

const DK_BETTING_SPLITS_URL =
  "https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/";
const STATE_PATH =
  process.env.ODDS_STATE_PATH || ".cache/draftkings_odds_alert_state.json";
const NTFY_TOPIC = String(process.env.NTFY_TOPIC || "").trim();
const SITE_URL = String(process.env.ODDS_ALERT_CLICK_URL || "https://ezpzpicks.com").trim();
const ALERT_IMPLIED_MOVE_MIN = numberEnv("ODDS_ALERT_IMPLIED_MOVE_MIN", 1.5);
const ALERT_TOTAL_MOVE_MIN = numberEnv("ODDS_ALERT_TOTAL_MOVE_MIN", 0.5);

const RLM_PUBLIC_MOVE_MIN = 5;
const RLM_PUBLIC_MOVE_STRONG = 10;
const RLM_IMPLIED_MOVE_MIN = 1.5;
const RLM_IMPLIED_MOVE_STRONG = 3;
const RLM_TOTAL_MOVE_MIN = 0.5;
const RLM_TOTAL_MOVE_STRONG = 1;

const MLB_TEAM_ALIASES = {
  "Arizona Diamondbacks": ["ARI Diamondbacks", "Diamondbacks", "Arizona"],
  "Atlanta Braves": ["ATL Braves", "Braves", "Atlanta"],
  "Baltimore Orioles": ["BAL Orioles", "Orioles", "Baltimore"],
  "Boston Red Sox": ["BOS Red Sox", "Red Sox", "Boston"],
  "Chicago Cubs": ["CHI Cubs", "CHC Cubs", "Cubs"],
  "Chicago White Sox": ["CHI White Sox", "CWS White Sox", "White Sox"],
  "Cincinnati Reds": ["CIN Reds", "Reds", "Cincinnati"],
  "Cleveland Guardians": ["CLE", "CLE Guardians", "Guardians", "Cleveland"],
  "Colorado Rockies": ["COL Rockies", "Rockies", "Colorado"],
  "Detroit Tigers": ["DET Tigers", "Tigers", "Detroit"],
  "Houston Astros": ["HOU Astros", "Astros", "Houston"],
  "Kansas City Royals": ["KC Royals", "KCR Royals", "Royals", "Kansas City"],
  "Los Angeles Angels": ["LA Angels", "LAA Angels", "Angels", "Los Angeles Angels"],
  "Los Angeles Dodgers": ["LA Dodgers", "LAD Dodgers", "Dodgers", "Los Angeles Dodgers"],
  "Miami Marlins": ["MIA Marlins", "Marlins", "Miami"],
  "Milwaukee Brewers": ["MIL", "MIL Brewers", "Brewers", "Milwaukee"],
  "Minnesota Twins": ["MIN Twins", "Twins", "Minnesota"],
  "New York Mets": ["NYM", "NY Mets", "NYM Mets", "Mets", "New York Mets"],
  "New York Yankees": ["NY Yankees", "NYY Yankees", "Yankees", "New York Yankees"],
  Athletics: ["Athletics", "OAK Athletics", "ATH Athletics", "Oakland Athletics"],
  "Philadelphia Phillies": ["PHI", "PHI Phillies", "Phillies", "Philadelphia"],
  "Pittsburgh Pirates": ["PIT", "PIT Pirates", "Pirates", "Pittsburgh"],
  "San Diego Padres": ["SD Padres", "SDP Padres", "Padres", "San Diego"],
  "San Francisco Giants": ["SF Giants", "SFG Giants", "Giants", "San Francisco"],
  "Seattle Mariners": ["SEA Mariners", "Mariners", "Seattle"],
  "St. Louis Cardinals": ["STL Cardinals", "Cardinals", "St Louis Cardinals", "St. Louis"],
  "Tampa Bay Rays": ["TB", "TBR", "TB Rays", "TBR Rays", "Rays", "Tampa Bay"],
  "Texas Rangers": ["TEX Rangers", "Rangers", "Texas"],
  "Toronto Blue Jays": ["TOR Blue Jays", "Blue Jays", "Toronto"],
  "Washington Nationals": ["WAS", "WSH", "WAS Nationals", "WSH Nationals", "Nationals", "Washington"],
};

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIAS_LOOKUP = new Map();
for (const [canonical, aliases] of Object.entries(MLB_TEAM_ALIASES)) {
  for (const alias of [canonical, ...aliases]) ALIAS_LOOKUP.set(textKey(alias), canonical);
}

function normalizeTeam(value) {
  const key = textKey(value);
  if (!key) return "";
  const exact = ALIAS_LOOKUP.get(key);
  if (exact) return exact;
  const contained = [...ALIAS_LOOKUP.entries()]
    .filter(([alias]) => alias && (key.endsWith(alias) || alias.endsWith(key)))
    .sort((a, b) => b[0].length - a[0].length);
  return contained[0]?.[1] || String(value || "").trim();
}

function easternDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value || 0),
    month: Number(parts.find((part) => part.type === "month")?.value || 0),
    day: Number(parts.find((part) => part.type === "day")?.value || 0),
  };
}

function todayET(date = new Date()) {
  const parts = easternDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function nowET(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function parseEventDate(value) {
  const match = String(value || "").match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const today = easternDateParts();
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  const candidates = [today.year - 1, today.year, today.year + 1]
    .map((year) => ({ year, distance: Math.abs(Date.UTC(year, month - 1, day) - todayUtc) }))
    .sort((a, b) => a.distance - b.distance);
  const year = candidates[0]?.year || today.year;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseEventTimeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const meridiem = raw.match(/(?:^|[,\s])(\d{1,2})(?::(\d{2}))\s*(AM|PM)\b/i);
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3].toUpperCase() === "PM") hour += 12;
    return `${String(hour).padStart(2, "0")}:${String(Number(meridiem[2] || 0)).padStart(2, "0")}`;
  }
  const twentyFour = raw.match(/(?:^|[,T\s])([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?:\s*(?:ET|EST|EDT))?\s*$/i);
  if (twentyFour) return `${String(Number(twentyFour[1])).padStart(2, "0")}:${twentyFour[2]}`;
  return "";
}

function numericLine(value) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/-?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value) {
  const parsed = Number(String(value || "").replace("%", "").trim());
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : NaN;
}

function isOdds(value) {
  return /^[+-]?\d{3,4}$/.test(String(value || "").replace(/−/g, "-").trim());
}

function isPercent(value) {
  return /^\d{1,3}(?:\.\d+)?%$/.test(String(value || "").trim());
}

function americanImpliedProbabilityPct(value) {
  const match = String(value ?? "").replace(/−/g, "-").match(/[+-]?\d+/);
  if (!match) return null;
  const odds = Number(match[0]);
  if (!Number.isFinite(odds) || Math.abs(odds) < 100) return null;
  const probability = odds < 0
    ? Math.abs(odds) / (Math.abs(odds) + 100)
    : 100 / (odds + 100);
  return Math.round(probability * 1000) / 10;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;|&ensp;|&emsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlTokens(rawHtml) {
  const cleaned = String(rawHtml || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, "\n");
  return decodeHtmlEntities(cleaned)
    .split(/\r?\n/)
    .map((item) => item.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseBettingSplits(rawHtml) {
  const tokens = htmlTokens(rawHtml);
  const rows = [];
  const marketNames = {
    Moneyline: "Moneyline",
    "Run Line": "Run Line",
    Spread: "Run Line",
    Total: "Total",
  };

  let i = 0;
  while (i < tokens.length - 1) {
    const gameToken = tokens[i] || "";
    const dateToken = tokens[i + 1] || "";
    if (!gameToken.includes(" @ ") || !/\d{1,2}\/\d{1,2}/.test(dateToken)) {
      i += 1;
      continue;
    }

    const [awayRaw = "", homeRaw = ""] = gameToken.split(" @ ", 2).map((part) => part.trim());
    const awayTeam = normalizeTeam(awayRaw);
    const homeTeam = normalizeTeam(homeRaw);
    if (!(awayTeam in MLB_TEAM_ALIASES) || !(homeTeam in MLB_TEAM_ALIASES)) {
      i += 2;
      continue;
    }

    const date = parseEventDate(dateToken);
    const eventTime = parseEventTimeKey(dateToken);
    const game = `${awayTeam} at ${homeTeam}`;
    i += 2;

    while (i < tokens.length) {
      if (
        i + 1 < tokens.length &&
        String(tokens[i] || "").includes(" @ ") &&
        /\d{1,2}\/\d{1,2}/.test(tokens[i + 1] || "")
      ) break;

      const market = marketNames[tokens[i] || ""];
      if (!market) {
        i += 1;
        continue;
      }

      let j = i + 1;
      while (["Odds", "% Handle", "% Bets"].includes(tokens[j] || "")) j += 1;
      let parsedMarketRows = 0;
      while (j + 3 < tokens.length) {
        if (marketNames[tokens[j] || ""]) break;
        if (
          j + 1 < tokens.length &&
          String(tokens[j] || "").includes(" @ ") &&
          /\d{1,2}\/\d{1,2}/.test(tokens[j + 1] || "")
        ) break;

        const [selection = "", rawOdds = "", rawMoneyPct = "", rawBetsPct = ""] = tokens.slice(j, j + 4);
        if (!(isOdds(rawOdds) && isPercent(rawMoneyPct) && isPercent(rawBetsPct))) break;
        const moneyPct = percent(rawMoneyPct);
        const betsPct = percent(rawBetsPct);
        if (!Number.isFinite(moneyPct) || !Number.isFinite(betsPct)) break;

        const side = selection.toLowerCase().startsWith("over")
          ? "Over"
          : selection.toLowerCase().startsWith("under")
            ? "Under"
            : "";
        const selectionTeam = market === "Total"
          ? ""
          : normalizeTeam(selection.replace(/\s+[+-]?\d+(?:\.\d+)?$/, ""));

        rows.push({
          date,
          eventTime,
          game,
          awayTeam,
          homeTeam,
          market,
          selection,
          selectionTeam,
          side,
          line: market === "Moneyline" ? null : numericLine(selection),
          odds: rawOdds.replace(/−/g, "-"),
          moneyPct,
          betsPct,
        });

        parsedMarketRows += 1;
        j += 4;
        if (parsedMarketRows >= 2) break;
      }
      i = Math.max(i + 1, j);
    }
  }

  const deduped = new Map();
  for (const row of rows) {
    deduped.set(`${row.date}|${row.game}|${parseEventTimeKey(row.eventTime || "")}|${row.market}|${textKey(row.selection)}`, row);
  }
  return [...deduped.values()];
}

async function fetchHtml(url, params) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  const response = await fetch(target, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; EZPZ-Picks-Odds-Monitor/1.0; +https://ezpzpicks.com)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchDraftKingsSplits() {
  const splits = [];
  const seen = new Set();
  const errors = [];
  for (let page = 1; page <= 10; page += 1) {
    try {
      const html = await fetchHtml(DK_BETTING_SPLITS_URL, {
        itm_content: "MLB",
        tb_edate: "n7days",
        tb_eg: "MLB",
        tb_page: String(page),
      });
      const pageRows = parseBettingSplits(html);
      let newRows = 0;
      for (const row of pageRows) {
        const key = `${row.date}|${row.game}|${parseEventTimeKey(row.eventTime || "")}|${row.market}|${textKey(row.selection)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        splits.push(row);
        newRows += 1;
      }
      if (!pageRows.length || newRows === 0) break;
    } catch (error) {
      errors.push(`page ${page}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
  }

  if (!splits.length) {
    try {
      splits.push(...parseBettingSplits(await fetchHtml(DK_BETTING_SPLITS_URL, {})));
    } catch (error) {
      errors.push(`fallback: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!splits.length) throw new Error(`DraftKings splits unavailable (${errors.join("; ") || "no rows"})`);
  return { splits, errors };
}

function splitKey(row) {
  const selectionKey = row.market === "Total" ? row.side : normalizeTeam(row.selectionTeam || row.selection);
  return `${row.date}|${row.game}|${parseEventTimeKey(row.eventTime || "")}|${row.market}|${textKey(selectionKey)}`;
}

function movementForSplit(current, opening) {
  const openingImpliedPct = americanImpliedProbabilityPct(opening.odds);
  const currentImpliedPct = americanImpliedProbabilityPct(current.odds);
  const publicMovementPct = Math.round((current.betsPct - opening.betsPct) * 10) / 10;
  let signal = "";
  let tone = "";
  let basis = "";
  let value = null;
  let standardPriceThreshold = RLM_IMPLIED_MOVE_MIN;
  let strongPriceThreshold = RLM_IMPLIED_MOVE_STRONG;

  if (current.market === "Total" && opening.line != null && current.line != null && current.side) {
    const selectedSideMove = current.side === "Over"
      ? current.line - opening.line
      : opening.line - current.line;
    if (Math.abs(selectedSideMove) >= RLM_TOTAL_MOVE_MIN) {
      basis = "Total Line";
      value = Math.round(selectedSideMove * 10) / 10;
      standardPriceThreshold = RLM_TOTAL_MOVE_MIN;
      strongPriceThreshold = RLM_TOTAL_MOVE_STRONG;
    }
  }

  if (value == null && openingImpliedPct != null && currentImpliedPct != null) {
    const impliedMove = Math.round((currentImpliedPct - openingImpliedPct) * 10) / 10;
    if (Math.abs(impliedMove) >= RLM_IMPLIED_MOVE_MIN) {
      basis = "Implied Probability";
      value = impliedMove;
      standardPriceThreshold = RLM_IMPLIED_MOVE_MIN;
      strongPriceThreshold = RLM_IMPLIED_MOVE_STRONG;
    }
  }

  if (value != null) {
    const meaningfulPublicMove = Math.abs(publicMovementPct) >= RLM_PUBLIC_MOVE_MIN;
    const oppositeDirections = publicMovementPct * value < 0;
    if (meaningfulPublicMove && oppositeDirections && Math.abs(value) >= standardPriceThreshold) {
      const strong =
        Math.abs(publicMovementPct) >= RLM_PUBLIC_MOVE_STRONG &&
        Math.abs(value) >= strongPriceThreshold;
      const supportedSide = value > 0;
      signal = supportedSide
        ? strong ? "Strong Reverse Line Movement Support" : "Reverse Line Movement Support"
        : strong ? "Strong Reverse Line Movement Against" : "Reverse Line Movement Against";
      tone = supportedSide ? "positive" : "negative";
    } else if (value > 0) {
      signal = "Line Movement Confirmation";
      tone = "positive";
    } else {
      signal = "Adverse Line Movement";
      tone = "negative";
    }
  }

  return { openingImpliedPct, currentImpliedPct, publicMovementPct, signal, tone, basis, value };
}

function changedEnough(current, previous, movement, previousMovement) {
  if (current.market === "Total" && current.line != null && previous.line != null && current.side) {
    const selectedSideMove = current.side === "Over"
      ? current.line - previous.line
      : previous.line - current.line;
    if (Math.abs(selectedSideMove) >= ALERT_TOTAL_MOVE_MIN) {
      return { changed: true, reason: "total" };
    }
  }

  const previousImplied = americanImpliedProbabilityPct(previous.odds);
  const currentImplied = americanImpliedProbabilityPct(current.odds);
  if (previousImplied != null && currentImplied != null) {
    const delta = Math.round((currentImplied - previousImplied) * 10) / 10;
    if (Math.abs(delta) >= ALERT_IMPLIED_MOVE_MIN) {
      return { changed: true, reason: "price" };
    }
  }

  if (movement.signal && movement.signal !== previousMovement?.signal) {
    return { changed: true, reason: "signal" };
  }
  return { changed: false, reason: "" };
}

function selectionDisplay(row) {
  if (row.market === "Total") return `${row.side} ${row.line ?? ""}`.trim();
  return row.selectionTeam || row.selection;
}

function snapshotDisplay(row) {
  if (row.market === "Total") return `${row.side} ${row.line ?? ""} ${row.odds}`.trim();
  return `${selectionDisplay(row)} ${row.odds}`.trim();
}

function signed(value, suffix = "") {
  if (value == null || !Number.isFinite(Number(value))) return "";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number}${suffix}`;
}

function priorityFor(movement) {
  if (movement.signal.startsWith("Strong Reverse")) return 5;
  if (movement.signal.includes("Reverse Line Movement") || movement.signal === "Adverse Line Movement") return 4;
  return 3;
}

function tagsFor(movement) {
  if (movement.signal.includes("Reverse Line Movement")) return ["rotating_light", "chart_with_upwards_trend"];
  if (movement.signal === "Adverse Line Movement") return ["warning", "chart_with_downwards_trend"];
  return ["chart_with_upwards_trend"];
}

function alertPayload(current, previous, opening, movement) {
  const basisLine = movement.basis && movement.value != null
    ? `${movement.basis}: ${signed(movement.value, movement.basis === "Implied Probability" ? "%" : "")}`
    : "Meaningful odds change";
  return {
    title: `EZPZ ${movement.signal || "Odds Movement"}`,
    message: [
      `${current.game}${current.eventTime ? ` (${current.eventTime} ET)` : ""}`,
      `${snapshotDisplay(previous)} → ${snapshotDisplay(current)}`,
      `Bets ${current.betsPct}% | Handle ${current.moneyPct}%`,
      basisLine,
      `Opening: ${snapshotDisplay(opening)}`,
    ].join("\n"),
    priority: priorityFor(movement),
    tags: tagsFor(movement),
    click: SITE_URL || undefined,
  };
}

async function publishNtfy(payload) {
  if (!NTFY_TOPIC) return false;
  if (!/^[-_A-Za-z0-9]{1,64}$/.test(NTFY_TOPIC)) {
    throw new Error("NTFY_TOPIC contains invalid characters or is longer than 64 characters.");
  }
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch("https://ntfy.sh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: NTFY_TOPIC, ...payload }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError || new Error("ntfy publish failed");
}

async function readState(date) {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
    if (parsed?.version === 2 && parsed?.date === date && parsed?.markets) return parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`Ignoring unreadable odds state: ${error.message || error}`);
  }
  return { version: 2, date, markets: {}, updatedAt: "" };
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const temporary = `${STATE_PATH}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, STATE_PATH);
}

async function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const date = todayET();
  const state = await readState(date);
  const { splits, errors } = await fetchDraftKingsSplits();
  const currentRows = splits.filter(
    (row) => row.date === date && (row.market === "Moneyline" || row.market === "Total"),
  );
  if (!currentRows.length) {
    console.log(`No current-day MLB Moneyline/Total rows found for ${date}.`);
    if (errors.length) console.log(`DraftKings warnings: ${errors.join("; ")}`);
    state.updatedAt = new Date().toISOString();
    await writeState(state);
    return;
  }

  let initialized = 0;
  let alertsSent = 0;
  for (const current of currentRows) {
    const key = splitKey(current);
    const entry = state.markets[key];
    const currentSnapshot = {
      date: current.date,
      eventTime: parseEventTimeKey(current.eventTime || ""),
      game: current.game,
      market: current.market,
      selection: current.selection,
      selectionTeam: current.selectionTeam,
      side: current.side,
      line: current.line,
      odds: current.odds,
      betsPct: current.betsPct,
      moneyPct: current.moneyPct,
      seenAt: nowET(),
    };

    if (!entry) {
      const baselineMovement = movementForSplit(currentSnapshot, currentSnapshot);
      state.markets[key] = {
        opening: currentSnapshot,
        previous: currentSnapshot,
        previousMovement: baselineMovement,
      };
      initialized += 1;
      continue;
    }

    const opening = entry.opening;
    const previous = entry.previous;
    const movement = movementForSplit(currentSnapshot, opening);
    const change = changedEnough(currentSnapshot, previous, movement, entry.previousMovement);

    if (change.changed) {
      const payload = alertPayload(currentSnapshot, previous, opening, movement);
      console.log(`ALERT [${change.reason}] ${payload.title}\n${payload.message}\n`);
      const sent = await publishNtfy(payload);
      if (sent) alertsSent += 1;
      else console.log("NTFY_TOPIC is not configured; alert logged but no phone push was sent.");
    }

    state.markets[key] = {
      ...entry,
      previous: currentSnapshot,
      previousMovement: movement,
    };
  }

  state.updatedAt = new Date().toISOString();
  await writeState(state);
  console.log(
    `DraftKings odds monitor complete: ${currentRows.length} markets checked, ${initialized} initialized, ${alertsSent} push alert(s) sent.`,
  );
  if (errors.length) console.log(`DraftKings warnings: ${errors.join("; ")}`);
}

function runSelfTest() {
  const html = `
    <div>ATL Braves @ NYM Mets</div><div>8/17</div>
    <div>Moneyline</div><div>Odds</div><div>% Handle</div><div>% Bets</div>
    <div>ATL Braves</div><div>-120</div><div>61%</div><div>56%</div>
    <div>NYM Mets</div><div>+105</div><div>39%</div><div>44%</div>
    <div>Total</div><div>Odds</div><div>% Handle</div><div>% Bets</div>
    <div>Over 7.5</div><div>-110</div><div>65%</div><div>60%</div>
    <div>Under 7.5</div><div>-110</div><div>35%</div><div>40%</div>
  `;
  const parsed = parseBettingSplits(html);
  if (parsed.length !== 4) throw new Error(`Self-test parse failed: expected 4 rows, got ${parsed.length}`);
  const over = parsed.find((row) => row.market === "Total" && row.side === "Over");
  if (!over || over.line !== 7.5 || over.betsPct !== 60 || over.moneyPct !== 65) {
    throw new Error("Self-test total parsing failed");
  }
  const gameOne = { ...over, eventTime: "13:40" };
  const gameTwo = { ...over, eventTime: "18:40" };
  if (splitKey(gameOne) === splitKey(gameTwo)) throw new Error("Self-test doubleheader key collision");
  if (parseEventTimeKey("8/17, 01:40PM") !== "13:40" || parseEventTimeKey("8/17, 06:40PM") !== "18:40") throw new Error("Self-test DraftKings event time parsing failed");
  const opening = { ...over, odds: "-110", line: 7.5, betsPct: 55 };
  const current = { ...over, odds: "+100", line: 8.5, betsPct: 65 };
  const movement = movementForSplit(current, opening);
  if (movement.signal !== "Line Movement Confirmation" || movement.basis !== "Total Line" || movement.value !== 1) {
    throw new Error(`Self-test movement failed: ${JSON.stringify(movement)}`);
  }
  console.log("DraftKings odds monitor self-test passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
