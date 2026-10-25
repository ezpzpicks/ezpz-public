/** Reprice an existing qualifying forecast; never change the tracked model pick.
 * Policies mirror mlb-mobile-admin's nfl_builder.py, nfl_game_regression.py,
 * cfb_market_calibration.py and nba_market.py/shared/market_grading.py.
 * A changed-line probability is an estimate anchored to the saved probability.
 */
type Quote = {
  sport: "NFL" | "NCAAF" | "NBA";
  market: "Spread" | "Total";
  side: string;
  version: string;
  policy?: string;
  savedLine: number;
  line: number;
  savedEdge: number;
  savedGrade: string;
  probability: number | null;
  reliability?: number | null;
  confluence?: number | null;
  odds: string;
};

export function quoteImpliedProbability(odds: unknown): number | null {
  const n = Number(String(odds ?? "").replace(/[−–—]/g, "-"));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n < 0 ? -n / (-n + 100) : 100 / (n + 100) : null;
}

// Standard normal CDF (absolute error below 8e-8).
export function modelNormalCdf(z: number): number {
  const x = Math.abs(z), t = 1 / (1 + 0.2316419 * x);
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t
    * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - tail : tail;
}

function normalQuantile(p: number) {
  let low = -10, high = 10;
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    if (modelNormalCdf(mid) < p) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

export function regradeModelQuote(q: Quote) {
  // Retain the original model's non-price gates (FBS eligibility, availability,
  // completeness, etc.). A quote change cannot promote a forecast on hold.
  if (!/^(?:A|B)(?: |$)/.test(q.savedGrade) && !/^(?:Strong )?(?:Over|Under)$/.test(q.savedGrade)) return null;
  const delta = q.market === "Spread" || q.side === "Under" ? q.line - q.savedLine : q.savedLine - q.line;
  const edge = q.savedEdge + delta;
  const savedP = q.probability != null && q.probability > 0 && q.probability < 1 ? q.probability : null;
  let probability = savedP, grade = "", supported = false, estimated = false;
  if (![q.savedLine, q.line, q.savedEdge].every(Number.isFinite)) return null;

  if (q.sport === "NFL" && /^nfl-v4\.28-/.test(q.version)
      && q.reliability != null && q.confluence != null && savedP != null) {
    supported = true;
    const factor = Math.max(0.92, Math.min(1.18, 1 + (70 - q.reliability) * 0.004));
    const sigma = (q.market === "Total" ? 13.338418166050308 : 13.251516312525167) * factor;
    if (Math.abs(delta) > 1e-9) {
      probability = Math.max(0, Math.min(1, savedP + modelNormalCdf(edge / sigma) - modelNormalCdf(q.savedEdge / sigma)));
      estimated = true;
    }
    // The only line-dependent confluence check is the minimum model edge.
    const minimum = q.market === "Total" ? 1.75 : 1.5;
    const confluence = q.confluence - Number(q.savedEdge >= minimum) + Number(edge >= minimum);
    const a = probability! >= 0.585 && edge >= (q.market === "Total" ? 3 : 2.5) && q.reliability >= 70 && confluence >= 4;
    const b = probability! >= 0.555 && edge >= minimum && q.reliability >= 62 && confluence >= 3;
    grade = q.market === "Spread" ? a ? "A Spread" : b ? "B Spread" : "Non-Edge Spread"
      : a ? `Strong ${q.side}` : b ? q.side : "Non-Edge Total";
  } else if (q.sport === "NCAAF" && /^cfb-v2\.8(?:\.1)?[-|]/.test(q.version) && savedP != null && savedP > 0.5 && q.savedEdge > 0) {
    supported = true;
    if (Math.abs(delta) > 1e-9) {
      // CFB's saved probabilities come from its game simulation. Preserve that
      // price calibration and estimate the change, rather than reusing old odds.
      const sigma = q.savedEdge / normalQuantile(savedP);
      probability = modelNormalCdf(edge / sigma);
      estimated = true;
    }
    const a = edge >= (q.market === "Spread" ? 10 : 6), b = edge >= (q.market === "Spread" ? 8 : 3);
    grade = q.market === "Spread" && Math.abs(q.line) >= 20 ? "No Play"
      : a ? `A ${q.market}` : b ? `B ${q.market}` : "No Play";
  } else if (q.sport === "NBA" && (q.policy === "shared-market-grade-nba-validation-normal-v1"
      || q.version.startsWith("nba-v0.5-market-grades-2026-10-22"))) {
    supported = true;
    probability = modelNormalCdf(edge / (q.market === "Total" ? 19.366926088529077 : 15.366295320255823));
    estimated = true;
    grade = edge >= 4.5 && probability >= 0.60 ? "A" : edge >= 3 && probability >= 0.565 ? "B"
      : edge >= 1.75 && probability >= 0.535 ? "Lean" : "Pass";
  }
  if (!supported) return null;
  const qualifying = /^(?:A|B)(?: |$)/.test(grade) || /^(?:Strong )?(?:Over|Under)$/.test(grade);
  const implied = quoteImpliedProbability(q.odds);
  const priceOkay = implied != null && probability != null && probability > implied;
  return { active: qualifying && priceOkay, grade, edge, probability, estimated,
    reason: implied == null ? "The current price is unavailable; no model signal is counted."
      : qualifying && !priceOkay ? "The current price no longer has positive expected value; no model signal is counted."
      : qualifying ? "Re-evaluated the saved forecast at this line and price; it still meets the model's qualifying requirements."
      : "Re-evaluated the saved forecast at this line; it no longer meets the model's qualifying requirements." };
}
