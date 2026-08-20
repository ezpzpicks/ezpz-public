import fs from "node:fs";

const path = "app/api/public-data/route.ts";
let text = fs.readFileSync(path, "utf8");
const original = text;

function replaceRequired(search, replacement, label, alreadyMarker = "") {
  if (alreadyMarker && text.includes(alreadyMarker)) return;
  const before = text;
  text = text.replace(search, replacement);
  if (text === before) throw new Error(`Structured AI patch could not find ${label}`);
}

// hot_pending_ai_patch runs before this file and may already have advanced the
// selector version. Replace whatever current selector version is present.
replaceRequired(
  /const AI_PICK_SELECTOR_VERSION = "[^"]+";/,
  'const AI_PICK_SELECTOR_VERSION = "hybrid-structured-context-v23-builder-first";',
  "AI selector version",
  'const AI_PICK_SELECTOR_VERSION = "hybrid-structured-context-v23-builder-first";',
);

replaceRequired(
  'const AI_PICK_SELECTOR_TAB = "ai_pick_selector";',
  'const AI_PICK_SELECTOR_TAB = "ai_pick_selector";\nconst AI_BUILDER_MATCHUP_DETAILS_TAB = "matchup_details_today";\nconst AI_BUILDER_CONTEXT_KEY = "__EZPZ_BUILDER_CONTEXT_JSON";',
  "AI builder constants",
  "AI_BUILDER_MATCHUP_DETAILS_TAB",
);

// Medium search context is reserved for the smaller amount of supplemental
// web research that remains after builder data is injected.
text = text.replace(
  'process.env.EZPZ_AI_SEARCH_CONTEXT_SIZE || "low"',
  'process.env.EZPZ_AI_SEARCH_CONTEXT_SIZE || "medium"',
);
text = text.replace(
  /\? \(configuredSearchContextSize as "low" \| "medium" \| "high"\)\n    : "low";/,
  '? (configuredSearchContextSize as "low" | "medium" | "high")\n    : "medium";',
);

const helperAnchor = "function aiCandidateResearchPayload(candidate: AiSelectorCandidate) {";
const helperCode = `function aiCompactStoredBuilderValue(value: any, depth = 0): any {
  if (value == null) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 240);
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, 4)
      .map((item) => aiCompactStoredBuilderValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value).slice(0, 28)) {
      if (["batter_matchup_rows", "raw_rows", "rows"].includes(String(key))) continue;
      const compact = aiCompactStoredBuilderValue(nested, depth + 1);
      if (compact !== undefined) out[key] = compact;
    }
    return out;
  }
  return String(value).slice(0, 240);
}

function aiCompactStoredBuilderPitcher(value: any) {
  if (!value || typeof value !== "object") return {};
  const keys = [
    "pitcher", "team", "opponent", "expected_ks", "raw_expected_ks", "six_ip_ks",
    "line", "odds", "edge", "variance", "volatility", "recent_form_note",
    "recent_accuracy_note", "six_inning_override_note", "weapon_floor_note",
    "k_context_note", "k_context", "grade", "raw_grade", "k_score",
    "selected_probability", "implied_probability", "price_edge", "publication_note",
    "grade_restriction_reason", "workload_support", "nine_hitter_passed",
    "lineup_hitters_found", "early_exit_risk", "grade_diagnostic",
  ];
  const out: Record<string, any> = {};
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== "") {
      out[key] = aiCompactStoredBuilderValue(value[key], 0);
    }
  }
  for (const section of ["recent_form", "lineup", "arsenal"]) {
    if (value[section] !== undefined) {
      out[section] = aiCompactStoredBuilderValue(value[section], 0);
    }
  }
  return out;
}

function aiStoredBuilderContextFromMatchupRow(row: SheetRow) {
  let details: any = {};
  const rawDetails = String(row["Details JSON"] || "").trim();
  if (rawDetails) {
    try {
      const parsed = JSON.parse(rawDetails);
      if (parsed && typeof parsed === "object") details = parsed;
    } catch {
      details = {};
    }
  }
  const pitchers = details?.pitchers && typeof details.pitchers === "object"
    ? details.pitchers
    : {};
  return {
    source: "EZPZ MLB builder / matchup_details_today",
    date: String(row["Date"] || ""),
    savedTimeET: String(row["Saved Time ET"] || ""),
    gameKey: String(row["Game Key"] || ""),
    gameLabel: String(row["Game Label"] || ""),
    awayTeam: String(row["Away Team"] || ""),
    homeTeam: String(row["Home Team"] || ""),
    awayPitcher: String(row["Away Pitcher"] || ""),
    homePitcher: String(row["Home Pitcher"] || ""),
    summary: String(row["Summary"] || "").slice(0, 500),
    pitchers: {
      away: aiCompactStoredBuilderPitcher(pitchers?.away),
      home: aiCompactStoredBuilderPitcher(pitchers?.home),
    },
    moneyline: aiCompactStoredBuilderValue(details?.moneyline || {}, 0),
    firstInning: aiCompactStoredBuilderValue(details?.nrfi || {}, 0),
    totalRuns: aiCompactStoredBuilderValue(details?.total_runs || {}, 0),
  };
}

function aiFindStoredBuilderMatchupRow(
  slateRow: SheetRow,
  matchupRows: SheetRow[],
  today: string,
) {
  const targetDate = normalizeDate(slateRow["Date"] || today) || today;
  const targetKey = normalizeText(slateRow["Game Key"] || "");
  const targetLabel = normalizeText(
    slateRow["Game Label"] || slateRow["Game"] || slateRow["Matchup"] || "",
  );
  const targetAway = normalizeText(slateRow["Away Team"] || "");
  const targetHome = normalizeText(slateRow["Home Team"] || "");
  const candidates = matchupRows
    .filter((row) => {
      const rowDate = normalizeDate(row["Date"] || "");
      return !rowDate || rowDate === targetDate;
    })
    .slice()
    .reverse();

  if (targetKey) {
    const exactKey = candidates.find(
      (row) => normalizeText(row["Game Key"] || "") === targetKey,
    );
    if (exactKey) return exactKey;
  }
  if (targetAway && targetHome) {
    const teamMatch = candidates.find(
      (row) =>
        normalizeText(row["Away Team"] || "") === targetAway &&
        normalizeText(row["Home Team"] || "") === targetHome,
    );
    if (teamMatch) return teamMatch;
  }
  if (targetLabel) {
    const labelMatch = candidates.find(
      (row) => normalizeText(row["Game Label"] || "") === targetLabel,
    );
    if (labelMatch) return labelMatch;
  }
  return null;
}

function attachAiBuilderContextToSlateRows(
  slateRows: SheetRow[],
  matchupRows: SheetRow[],
  today: string,
) {
  if (!matchupRows.length) return slateRows;
  return slateRows.map((row) => {
    const matchupRow = aiFindStoredBuilderMatchupRow(row, matchupRows, today);
    if (!matchupRow) return row;
    return {
      ...row,
      [AI_BUILDER_CONTEXT_KEY]: JSON.stringify(
        aiStoredBuilderContextFromMatchupRow(matchupRow),
      ),
    };
  });
}

async function safeReadAiBuilderMatchupRows() {
  try {
    return await readWorksheet(AI_BUILDER_MATCHUP_DETAILS_TAB);
  } catch (error) {
    console.warn(
      "AI structured builder context unavailable; continuing with slate/web context:",
      error instanceof Error ? error.message : String(error),
    );
    return [] as SheetRow[];
  }
}

`;

if (!text.includes("function aiCompactStoredBuilderValue(")) {
  if (!text.includes(helperAnchor)) throw new Error("Structured AI helper anchor not found");
  text = text.replace(helperAnchor, helperCode + helperAnchor);
}

// Inject a separate builderGameContext immediately after modelGameContext is assembled.
if (!text.includes("let builderGameContext: Record<string, any>")) {
  replaceRequired(
    /(  const modelGameContext = anchor\.slateRow[\s\S]*?\n    : \{\};)\n\n  return \{\n    gameKey: anchor\.gameKey,/,
    `$1\n\n  let builderGameContext: Record<string, any> = {};\n  const builderContextRaw = String(\n    anchor.slateRow?.[AI_BUILDER_CONTEXT_KEY] || "",\n  ).trim();\n  if (builderContextRaw) {\n    try {\n      const parsed = JSON.parse(builderContextRaw);\n      if (parsed && typeof parsed === "object") builderGameContext = parsed;\n    } catch {\n      builderGameContext = {};\n    }\n  }\n\n  return {\n    gameKey: anchor.gameKey,`,
    "builder context extraction",
  );
}

replaceRequired(
  `    homeTeam: anchor.homeTeam,\n    modelGameContext,\n    candidates: candidates.map((candidate) => aiCandidateResearchPayload(candidate)),`,
  `    homeTeam: anchor.homeTeam,\n    builderContextAvailable: Object.keys(builderGameContext).length > 0,\n    builderGameContext,\n    modelGameContext,\n    candidates: candidates.map((candidate) => aiCandidateResearchPayload(candidate)),`,
  "builder context payload fields",
  "builderContextAvailable: Object.keys(builderGameContext).length > 0",
);

replaceRequired(
`    const [slateTodayRaw, trackerRaw, liveDraftKings, initialSavedPublicSplits, storedAiPickRows] = await Promise.all([
      readWorksheet("daily_slate"),
      readWorksheet("bet_tracker"),
      loadDraftKingsData(),
      safeReadPublicSplitRows(),
      safeReadAiPickRows(),
    ]);`,
`    const [slateTodayRaw, trackerRaw, liveDraftKings, initialSavedPublicSplits, storedAiPickRows, matchupDetailsRaw] = await Promise.all([
      readWorksheet("daily_slate"),
      readWorksheet("bet_tracker"),
      loadDraftKingsData(),
      safeReadPublicSplitRows(),
      safeReadAiPickRows(),
      safeReadAiBuilderMatchupRows(),
    ]);`,
  "main matchup-details read",
  "matchupDetailsRaw] = await Promise.all",
);

replaceRequired(
`    const slateToday = slateTodayRaw.filter(
      (row: SheetRow) => normalizeDate(row["Date"]) === today,
    );
    const publicDraftKings = publicDisplayDraftKingsPayload(`,
`    const slateToday = slateTodayRaw.filter(
      (row: SheetRow) => normalizeDate(row["Date"]) === today,
    );
    const aiSlateToday = attachAiBuilderContextToSlateRows(
      slateToday as SheetRow[],
      matchupDetailsRaw as SheetRow[],
      today,
    );
    const publicDraftKings = publicDisplayDraftKingsPayload(`,
  "AI structured slate merge",
  "const aiSlateToday = attachAiBuilderContextToSlateRows",
);

replaceRequired(
  "      slateRows: slateToday,",
  "      slateRows: aiSlateToday,",
  "AI selector structured slate input",
  "      slateRows: aiSlateToday,",
);

// ai_research_sources_patch runs before this patch. Upgrade those source rules
// so saved builder facts are used before any external lookup.
text = text.replace(
  "You are the final pregame MLB research analyst for EZPZ AI Picks. Perform targeted web research for this one game, then evaluate every supplied candidate using the same verified pregame facts. Never use information from after first pitch and do not invent statistics.",
  "You are the final pregame MLB research analyst for EZPZ AI Picks. Start with the supplied EZPZ structured builder data, then use targeted web research only to fill decision-relevant gaps or verify genuinely time-sensitive context. Evaluate every supplied candidate using the same pregame facts. Never use information from after first pitch and do not invent statistics.",
);
text = text.replace(
  "1) STARTERS + TODAY'S LINEUPS: First use MLB.com official Probable Pitchers/Gameday for confirmed starters and official lineup information. Use RotoWire MLB Daily Lineups as the primary backup and as the preferred projected-lineup source when MLB has not posted a confirmed lineup. Do not claim a lineup or starter could not be found until MLB.com and RotoWire have both been attempted.",
  "1) STARTERS + TODAY'S LINEUPS: First use builderGameContext. The MLB builder already fetches/stores scheduled pitchers and confirmed-lineup diagnostics when available. Only when those fields are missing, projected, stale, or internally inconsistent should you search MLB.com official Probable Pitchers/Gameday, with RotoWire MLB Daily Lineups as backup/projected-lineup context. Never call an EZPZ-supplied starter or confirmed lineup unverified merely because web search did not independently return it.",
);
text = text.replace(
  "2) BULLPEN AVAILABILITY/USAGE: First use ESPN's previous-game box score and pitching lines to identify relievers used, innings/pitches when available, and back-to-back workload. MLB.com previous-game box scores/Gameday are the backup. Focus on the previous 1-2 days and the leverage relievers most likely to matter tonight.",
  "2) BULLPEN AVAILABILITY/USAGE: First use builderGameContext/modelGameContext for bullpen strength, fatigue, usage, or run-prevention context already supplied by EZPZ. If exact recent reliever usage is still missing and material, use ESPN's previous-game box score and pitching lines, with MLB.com previous-game box scores/Gameday as backup. Focus on the previous 1-2 days and leverage relievers most likely to matter tonight.",
);
text = text.replace(
  "3) STARTER RECENT FORM + WORKLOAD: Prefer MLB.com or ESPN game logs for the last 3-5 starts. For pitcher strikeout candidates, use Baseball Savant when useful for whiff, strikeout, arsenal, pitch-mix, velocity, or matchup evidence.",
  "3) STARTER RECENT FORM + WORKLOAD: First use builderGameContext, which can contain the builder's recent-form, workload/leash, strikeout, arsenal, pitch-mix, and lineup matchup diagnostics. Only search MLB.com/ESPN game logs or Baseball Savant when a decision-relevant field is absent, stale, or needs current qualitative confirmation.",
);
text = text.replace(
  "4) TEAM RECENT FORM: Prefer MLB.com or ESPN schedule/results for recent games. Use relevant recent scoring/run-prevention context rather than generic season record alone.",
  "4) TEAM RECENT FORM: Use any recent-form/run-projection context already supplied by EZPZ first. Search MLB.com or ESPN schedule/results only when the structured context lacks the recent information needed for this wager. Use relevant recent scoring/run-prevention context rather than generic season record alone.",
);
text = text.replace(
  "Use modelGameContext as the primary quantitative source. The purpose of external research is NOT to rediscover or independently corroborate the model/trend signal. Its purpose is to determine whether today's specific matchup provides verified evidence that strengthens, weakens, or leaves unchanged the supplied quantitative case.",
  "Use builderGameContext as the PRIMARY source for matchup facts produced by the EZPZ MLB builder, and modelGameContext as the primary slate/model quantitative source. builderGameContext comes from the builder's saved matchup_details_today record and may include starters, confirmed-lineup diagnostics, pitcher recent form/workload, strikeout matchup information, moneyline/bullpen context, first-inning context, and total-run context. Do not spend web-search calls re-discovering facts already present there. External research is supplemental: use it for missing, time-sensitive, qualitative, injury/news, exact bullpen-usage, weather, or split context. Its purpose is not to independently corroborate the model/trend signal; it is to determine whether today's specific matchup contains evidence that strengthens, weakens, or leaves unchanged the supplied quantitative case.",
);

const missingAnchor =
  "MISSING INFORMATION IS NEUTRAL, NOT NEGATIVE. Failure to find or verify a requested fact is never evidence against a wager.";
const structuredRules = `STRUCTURED DATA RULES\n- builderGameContext is trusted EZPZ builder output for this exact game. Treat explicit factual fields as verified internal inputs unless the field itself says projected, fallback, stale, missing, or uncertain.\n- modelGameContext is trusted EZPZ slate/model data. Use it together with builderGameContext before web search.\n- If builderGameContext names the scheduled pitchers, do not say the starters could not be verified because MLB.com/RotoWire search results were absent.\n- If builderGameContext reports an MLB confirmed lineup or lineup-derived hitter metrics, use them directly. Search for today's lineup only when the structured data says fallback/projected/missing or there is a credible current contradiction.\n- If builderGameContext includes recent form, workload/leash, pitch-count context, arsenal/whiff context, bullpen context, first-inning context, or total-run context, use those values before searching the web.\n- A web-search failure never overrides a concrete structured fact. Only a direct, current, high-quality contradiction may create a conflict.\n- In the explanation, describe builder-supplied facts as EZPZ structured data and web findings as supplemental research. Do not write a long source audit.\n\n`;
if (!text.includes("builderGameContext is trusted EZPZ builder output")) {
  if (!text.includes(missingAnchor)) throw new Error("Structured AI missing-information anchor not found");
  text = text.replace(missingAnchor, structuredRules + missingAnchor);
}

text = text.replace(
  "The shared fields must be concise but matchup-specific: startingPitching names both starters and any prop pitcher and notes confirmed/projected lineup context when material; bullpenAnalysis covers previous-game usage/availability or says no material concern was verified; recentTeamForm covers both teams; historicalMatchup includes meaningful split/history sample context or says no meaningful sample exists.",
  "The shared fields must be concise but matchup-specific: startingPitching names both starters and any prop pitcher and notes confirmed/projected lineup context when material; bullpenAnalysis uses structured bullpen context first and supplements exact recent reliever usage when needed; recentTeamForm covers both teams using structured context first; historicalMatchup includes meaningful split/history sample context or says no meaningful sample exists. Never describe a concrete builderGameContext/modelGameContext fact as unverified simply because web search failed to reproduce it.",
);

if (text !== original) {
  fs.writeFileSync(path, text, "utf8");
  console.log("Applied structured-data-first MLB AI research using saved builder matchup details.");
} else {
  console.log("Structured-data-first MLB AI research patch already present.");
}
