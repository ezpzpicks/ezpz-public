from pathlib import Path

CORE = Path("app/api/public-data-core.ts")
PAGE = Path("app/page.tsx")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_count(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected} matches, found {count}")
    return text.replace(old, new)


core = CORE.read_text()
page = PAGE.read_text()

core = replace_once(
    core,
    'const AI_PICK_SELECTOR_VERSION = "ezpz-picks-hardcoded-v7-hot-best-immediate-final";',
    'const AI_PICK_SELECTOR_VERSION = "ezpz-picks-market-specific-v8";',
    "selector version",
)

core = replace_once(
    core,
    '''// PERMANENT EZPZ PICKS POLICY. These are normal source rules, not build patches.\n// Best Play path: HOT only, with a maximum price of -150.\n// Trend path: every signal green plus at least +10% net ROI vs the opposing side.\nconst EZPZ_BEST_PLAY_POLICY = {\n  requiredForm: "HOT" as const,\n  maxFavoritePrice: -150,\n  minimumScore: 74,\n  minimumProbability: 50,\n  minimumAdvantage: 1.5,\n};\n\nconst AI_HOT_BEST_PLAY_FINAL_MARKER =\n  "HOT Best Play is final for the full day; no separate pregame finalization is required";''',
    '''// PERMANENT EZPZ PICKS POLICY. Best Play qualification is market-specific.\n// The individual market rules are declared after AiPickMarket below.\n// Trend path: every signal green plus at least +10% net ROI vs the opposing side.\nconst AI_BEST_PLAY_FINAL_MARKER =\n  "EZPZ Best Play is final for the full day; no separate pregame finalization is required";''',
    "global Best Play policy",
)

core = replace_once(
    core,
    '''type AiPickSource = "Best Play" | "Trend Play" | "Best + Trend";\ntype AiPickMarket = "Moneyline" | "Total" | "Pitcher Strikeouts" | "First Inning";\ntype AiPickSnapshotStatus = "LIVE" | "FINAL_PREGAME";''',
    '''type AiPickSource = "Best Play" | "Trend Play" | "Best + Trend";\ntype AiPickMarket = "Moneyline" | "Total" | "Pitcher Strikeouts" | "First Inning";\n\ntype EzpzBestPlayPolicy = {\n  requiredForm?: "HOT";\n  maxFavoritePrice: number;\n  minimumReliability?: number;\n  minimumSelectedProbability?: number;\n};\n\n// Each Best Play market owns its own EZPZ qualification policy.\n// Moneyline, full-game totals, and first-inning markets retain the existing\n// HOT + price-cap rule. Pitcher strikeouts use the stronger market-specific\n// reliability/probability rule identified in the historical audit.\nconst EZPZ_BEST_PLAY_POLICIES: Record<AiPickMarket, EzpzBestPlayPolicy> = {\n  Moneyline: { requiredForm: "HOT", maxFavoritePrice: -150 },\n  Total: { requiredForm: "HOT", maxFavoritePrice: -150 },\n  "First Inning": { requiredForm: "HOT", maxFavoritePrice: -150 },\n  "Pitcher Strikeouts": {\n    maxFavoritePrice: -150,\n    minimumReliability: 80,\n    minimumSelectedProbability: 65,\n  },\n};\n\nfunction aiBestPlayPolicy(market: AiPickMarket) {\n  return EZPZ_BEST_PLAY_POLICIES[market];\n}\n\ntype AiPickSnapshotStatus = "LIVE" | "FINAL_PREGAME";''',
    "market-specific policy insertion",
)

core = replace_once(
    core,
    '''function aiPitcherRequiredScore(\n  _record: RecordTotals,\n  _form: AiPitcherBetTypeForm,\n) {\n  return EZPZ_BEST_PLAY_POLICY.minimumScore;\n}\n\ntype AiPitcherQualificationProfile = {\n  score: number;\n  probability: number;\n  advantage: number;\n  enforceProbability: boolean;\n};\n\nfunction aiPitcherQualificationProfile(\n  _form: AiPitcherBetTypeForm | undefined,\n  _record: RecordTotals | null = null,\n): AiPitcherQualificationProfile {\n  return {\n    score: EZPZ_BEST_PLAY_POLICY.minimumScore,\n    probability: EZPZ_BEST_PLAY_POLICY.minimumProbability,\n    advantage: EZPZ_BEST_PLAY_POLICY.minimumAdvantage,\n    enforceProbability: true,\n  };\n}\n''',
    '''type AiBestPlayQualification = {\n  qualifies: boolean;\n  label: string;\n  status: string;\n  failure: string;\n};\n\nfunction aiBestPlayQualification(\n  candidate: AiSelectorCandidate,\n): AiBestPlayQualification {\n  if (!candidate.bestPlayType) {\n    return { qualifies: false, label: "", status: "", failure: "" };\n  }\n\n  const policy = aiBestPlayPolicy(candidate.market);\n  if (candidate.market === "Pitcher Strikeouts") {\n    const reliability = normalizePercentValue(candidate.bestPlay?.reliability || "");\n    const selectedProbability = normalizePercentValue(\n      candidate.bestPlay?.selectedProbability || "",\n    );\n    const minimumReliability = policy.minimumReliability ?? 80;\n    const minimumSelectedProbability = policy.minimumSelectedProbability ?? 65;\n    const failures: string[] = [];\n    if (reliability < minimumReliability) {\n      failures.push(\n        `Pitcher K reliability ${reliability.toFixed(0)} did not reach ${minimumReliability}+`,\n      );\n    }\n    if (selectedProbability < minimumSelectedProbability) {\n      failures.push(\n        `Pitcher K selected probability ${selectedProbability.toFixed(1)}% did not reach ${minimumSelectedProbability}%+`,\n      );\n    }\n    return {\n      qualifies: failures.length === 0,\n      label: `Pitcher K reliability ${reliability.toFixed(0)} / selected probability ${selectedProbability.toFixed(1)}%`,\n      status: `Pitcher K EZPZ gate: reliability ${reliability.toFixed(0)} (min ${minimumReliability}) • selected probability ${selectedProbability.toFixed(1)}% (min ${minimumSelectedProbability}%) • odds no worse than ${policy.maxFavoritePrice}`,\n      failure: failures.join(" • "),\n    };\n  }\n\n  const requiredForm = policy.requiredForm || "HOT";\n  const form = candidate.pitcherBetTypeForm || "SAMPLE";\n  const formLabel =\n    form === "HOT"\n      ? "Hot"\n      : form === "NEUTRAL"\n        ? "Neutral"\n        : form === "COLD"\n          ? "Cold"\n          : "Need 7 Bets";\n  const record = candidate.pitcherBetTypeRecord || "0-0-0";\n  const qualifies = form === requiredForm;\n  return {\n    qualifies,\n    label: `${requiredForm} Last-7 (${record})`,\n    status: `${candidate.bestPlayType} Last 7 Bets: ${formLabel} • ${record} • EZPZ gate ${requiredForm} + odds no worse than ${policy.maxFavoritePrice}`,\n    failure: qualifies\n      ? ""\n      : `${candidate.bestPlayType} Last 7 Bets is ${formLabel} (${record}); ${candidate.market} Best Play EZPZ Picks require ${requiredForm} form`,\n  };\n}\n''',
    "replace legacy universal Best Play profile",
)

old_record_adjustments = '''function aiRecordAdjustments(candidate: AiSelectorCandidate, completedTrackerRows: SheetRow[]) {\n  const recordType = aiHistoricalRecordType(candidate);\n  if (!recordType) return;\n\n  // Trend-only candidates are graded by their Trend Score and final external AI\n  // approval. The model bet-type form gate applies only when this exact wager is\n  // also backed by a Best Play.\n  if (!candidate.bestPlayType) {\n    candidate.dataStatus.push(\n      "Trend-only candidate: Last 7 Bets model-grade gate does not apply",\n    );\n    return;\n  }\n\n  // Every Best Play market uses the same rolling Last-7-Bets form. The\n  // Best Play EZPZ path is HOT-only: seven completed bets are required and at\n  // least five of those seven must be wins. Neutral, Cold, and Small Sample\n  // can never qualify through the Best Play path.\n  const lastSeven = aiLastSevenBetsSummaryForType(\n    completedTrackerRows,\n    recordType,\n    candidate.date,\n  );\n  const form = aiPitcherBetTypeForm(lastSeven);\n  const profile = aiPitcherQualificationProfile(form, lastSeven);\n  candidate.pitcherBetTypeForm = form;\n  candidate.pitcherBetTypeRecord = lastSeven.record;\n  candidate.pitcherRequiredScore = profile.score;\n\n  if (form !== EZPZ_BEST_PLAY_POLICY.requiredForm) {\n    const formLabel =\n      form === "NEUTRAL"\n        ? "Neutral"\n        : form === "COLD"\n          ? "Cold"\n          : "Need 7 Bets";\n    const reason =\n      `${recordType} Last 7 Bets is ${formLabel} (${lastSeven.record}); ` +\n      "Best Play EZPZ Picks are HOT-only (7 completed bets with 5+ wins)";\n\n    candidate.historicalNotes.push(\n      form === "SAMPLE"\n        ? `${recordType} Last 7 Bets: Need 7 Bets • ${lastSeven.totalBets}/7 completed`\n        : `${recordType} Last 7 Bets: ${formLabel} • ${lastSeven.record}`,\n    );\n\n    // Best + Trend is two independent qualification paths.\n    if (candidate.trendPlay) {\n      candidate.dataStatus.push(\n        `${reason} • Best Play path excluded; Trend path remains independently eligible`,\n      );\n    } else {\n      candidate.protectionReasons.push(reason);\n      candidate.dataStatus.push(`${reason} • blocked`);\n    }\n    return;\n  }\n\n  candidate.dataStatus.push(\n    `${recordType} Last 7 Bets: Hot • ${lastSeven.record} • minimum score ${profile.score} • minimum probability ${profile.probability}% • minimum advantage ${profile.advantage}%`,\n  );\n  candidate.historicalNotes.push(\n    `${recordType} Last 7 Bets: Hot • ${lastSeven.record}`,\n  );\n  candidate.whySelected.push(\n    `${recordType} is Hot over its last 7 completed bets (${lastSeven.record}); Best Play gates are score 74+, estimated probability 50%+, estimated advantage 1.5%+, and odds no worse than -150`,\n  );\n}\n'''

new_record_adjustments = '''function aiRecordAdjustments(candidate: AiSelectorCandidate, completedTrackerRows: SheetRow[]) {\n  const recordType = aiHistoricalRecordType(candidate);\n  if (!recordType) return;\n\n  // Trend-only candidates are graded by their Trend Score. Best Play market\n  // qualification applies only when this exact wager is backed by a Best Play.\n  if (!candidate.bestPlayType) {\n    candidate.dataStatus.push(\n      "Trend-only candidate: Best Play market qualification does not apply",\n    );\n    return;\n  }\n\n  const lastSeven = aiLastSevenBetsSummaryForType(\n    completedTrackerRows,\n    recordType,\n    candidate.date,\n  );\n  const form = aiPitcherBetTypeForm(lastSeven);\n  candidate.pitcherBetTypeForm = form;\n  candidate.pitcherBetTypeRecord = lastSeven.record;\n\n  // Pitcher strikeouts no longer use HOT/COLD as the EZPZ gate. Their own\n  // historically stronger rule is Reliability 80+ and Selected Probability\n  // 65%+, while the rolling Last-7 record remains visible as context only.\n  if (candidate.market === "Pitcher Strikeouts") {\n    const qualification = aiBestPlayQualification(candidate);\n    candidate.dataStatus.push(qualification.status);\n    candidate.historicalNotes.push(\n      `${recordType} Last 7 Bets: ${lastSeven.record} • informational only for Pitcher K EZPZ qualification`,\n    );\n    if (qualification.qualifies) {\n      candidate.whySelected.push(\n        `Pitcher K qualifies with ${qualification.label}; rolling HOT/COLD form is not used as the gate`,\n      );\n    }\n    return;\n  }\n\n  const policy = aiBestPlayPolicy(candidate.market);\n  if (form !== policy.requiredForm) {\n    const formLabel =\n      form === "NEUTRAL"\n        ? "Neutral"\n        : form === "COLD"\n          ? "Cold"\n          : "Need 7 Bets";\n    const reason =\n      `${recordType} Last 7 Bets is ${formLabel} (${lastSeven.record}); ` +\n      `${candidate.market} Best Play EZPZ Picks require HOT form (7 completed bets with 5+ wins)`;\n\n    candidate.historicalNotes.push(\n      form === "SAMPLE"\n        ? `${recordType} Last 7 Bets: Need 7 Bets • ${lastSeven.totalBets}/7 completed`\n        : `${recordType} Last 7 Bets: ${formLabel} • ${lastSeven.record}`,\n    );\n\n    // Best + Trend is two independent qualification paths.\n    if (candidate.trendPlay) {\n      candidate.dataStatus.push(\n        `${reason} • Best Play path excluded; Trend path remains independently eligible`,\n      );\n    } else {\n      candidate.protectionReasons.push(reason);\n      candidate.dataStatus.push(`${reason} • blocked`);\n    }\n    return;\n  }\n\n  const qualification = aiBestPlayQualification(candidate);\n  candidate.dataStatus.push(qualification.status);\n  candidate.historicalNotes.push(\n    `${recordType} Last 7 Bets: Hot • ${lastSeven.record}`,\n  );\n  candidate.whySelected.push(\n    `${recordType} is Hot over its last 7 completed bets (${lastSeven.record}); ${candidate.market} EZPZ gate is HOT plus odds no worse than ${policy.maxFavoritePrice}`,\n  );\n}\n'''
core = replace_once(core, old_record_adjustments, new_record_adjustments, "record adjustments")

core = replace_once(
    core,
    '''  const playableOdds = parseAmericanOdds(candidate.odds);\n  if (!String(candidate.odds || "").trim() || !playableOdds) {\n    candidate.protectionReasons.push("Playable odds are missing");\n  } else if (playableOdds < EZPZ_BEST_PLAY_POLICY.maxFavoritePrice) {\n    candidate.protectionReasons.push(\n      "EZPZ Pick odds " + playableOdds + " exceed the -150 maximum price",\n    );\n    candidate.dataStatus.push("EZPZ Picks odds cap: -150 maximum");\n  }''',
    '''  const playableOdds = parseAmericanOdds(candidate.odds);\n  const bestPlayPolicy = aiBestPlayPolicy(candidate.market);\n  if (!String(candidate.odds || "").trim() || !playableOdds) {\n    candidate.protectionReasons.push("Playable odds are missing");\n  } else if (playableOdds < bestPlayPolicy.maxFavoritePrice) {\n    candidate.protectionReasons.push(\n      "EZPZ Pick odds " + playableOdds + " exceed the " + bestPlayPolicy.maxFavoritePrice + " maximum price",\n    );\n    candidate.dataStatus.push(\n      "EZPZ Picks odds cap: " + bestPlayPolicy.maxFavoritePrice + " maximum",\n    );\n  }''',
    "market-specific odds cap",
)

core = replace_once(
    core,
    '''  const bestPlayProfile = candidate.bestPlayType\n    ? aiPitcherQualificationProfile(candidate.pitcherBetTypeForm)\n    : null;''',
    '''  const bestPlayPolicy = aiBestPlayPolicy(candidate.market);''',
    "research payload policy",
)

core = replace_once(
    core,
    '''    underlyingPitcherKModelScore:\n      candidate.market === "Pitcher Strikeouts" ? parseScore(candidate.bestPlay?.score || 0) : undefined,\n    pitcherKGrade:\n      candidate.market === "Pitcher Strikeouts" ? candidate.bestPlayType : undefined,\n    bestPlayLast7BetsForm:\n      candidate.bestPlayType ? candidate.pitcherBetTypeForm : undefined,\n    bestPlayLast7BetsRecord:\n      candidate.bestPlayType ? candidate.pitcherBetTypeRecord : undefined,\n    bestPlayQualificationThresholds:\n      bestPlayProfile\n        ? {\n            score: candidate.pitcherRequiredScore || bestPlayProfile.score,\n            estimatedProbability: bestPlayProfile.probability,\n            estimatedAdvantage: bestPlayProfile.advantage,\n          }\n        : undefined,\n    // Keep pitcher-specific aliases for compatibility with older debug/review payloads.\n    pitcherLast7BetsForm:\n      candidate.market === "Pitcher Strikeouts" ? candidate.pitcherBetTypeForm : undefined,\n    pitcherLast7BetsRecord:\n      candidate.market === "Pitcher Strikeouts" ? candidate.pitcherBetTypeRecord : undefined,\n    pitcherQualificationThresholds:\n      candidate.market === "Pitcher Strikeouts" && bestPlayProfile\n        ? {\n            score: candidate.pitcherRequiredScore || bestPlayProfile.score,\n            estimatedProbability: bestPlayProfile.probability,\n            estimatedAdvantage: bestPlayProfile.advantage,\n          }\n        : undefined,''',
    '''    underlyingPitcherKModelScore:\n      candidate.market === "Pitcher Strikeouts" ? parseScore(candidate.bestPlay?.score || 0) : undefined,\n    pitcherKReliability:\n      candidate.market === "Pitcher Strikeouts"\n        ? normalizePercentValue(candidate.bestPlay?.reliability || "")\n        : undefined,\n    pitcherKSelectedProbability:\n      candidate.market === "Pitcher Strikeouts"\n        ? normalizePercentValue(candidate.bestPlay?.selectedProbability || "")\n        : undefined,\n    pitcherKGrade:\n      candidate.market === "Pitcher Strikeouts" ? candidate.bestPlayType : undefined,\n    bestPlayLast7BetsForm:\n      candidate.bestPlayType ? candidate.pitcherBetTypeForm : undefined,\n    bestPlayLast7BetsRecord:\n      candidate.bestPlayType ? candidate.pitcherBetTypeRecord : undefined,\n    bestPlayQualificationThresholds: candidate.bestPlayType\n      ? {\n          requiredForm: bestPlayPolicy.requiredForm,\n          maxFavoritePrice: bestPlayPolicy.maxFavoritePrice,\n          minimumReliability: bestPlayPolicy.minimumReliability,\n          minimumSelectedProbability: bestPlayPolicy.minimumSelectedProbability,\n        }\n      : undefined,\n    // Keep pitcher-specific aliases for compatibility with older debug/review payloads.\n    pitcherLast7BetsForm:\n      candidate.market === "Pitcher Strikeouts" ? candidate.pitcherBetTypeForm : undefined,\n    pitcherLast7BetsRecord:\n      candidate.market === "Pitcher Strikeouts" ? candidate.pitcherBetTypeRecord : undefined,\n    pitcherQualificationThresholds:\n      candidate.market === "Pitcher Strikeouts"\n        ? {\n            reliability: bestPlayPolicy.minimumReliability,\n            selectedProbability: bestPlayPolicy.minimumSelectedProbability,\n            maxFavoritePrice: bestPlayPolicy.maxFavoritePrice,\n          }\n        : undefined,''',
    "research payload market thresholds",
)

core = replace_once(
    core,
    '''function aiPriorityReviewCandidate(candidate: AiSelectorCandidate) {\n  const bestPlayLabel = `${candidate.bestPlayType || ""} ${candidate.bestPlay?.playType || ""}`.toUpperCase();\n  // COLD is a hard exclusion. A Strong/Elite label must never override the\n  // exact Last-7 pitcher bet-type form shown on the Best Plays card.\n  if (candidate.pitcherBetTypeForm === "COLD") return false;\n  return (\n    candidate.pitcherBetTypeForm === "HOT" ||\n    /\\b(STRONG|ELITE)\\b/.test(bestPlayLabel) ||\n    candidate.trendTier === "Strong" ||\n    candidate.trendTier === "Elite"\n  );\n}\n\nfunction aiPriorityReviewLabel(candidate: AiSelectorCandidate) {\n  const labels: string[] = [];\n  const rawBestPlay = String(candidate.bestPlay?.playType || candidate.bestPlayType || "").trim();\n  if (/\\b(STRONG|ELITE)\\b/i.test(rawBestPlay)) labels.push(rawBestPlay);\n  if (candidate.trendTier === "Strong" || candidate.trendTier === "Elite") {\n    labels.push(`${candidate.trendTier} Trend Play`);\n  }\n  if (candidate.pitcherBetTypeForm === "HOT") {\n    labels.push(\n      `HOT Last-7 Best Play (${candidate.pitcherBetTypeRecord || "0-0-0"})`,\n    );\n  }\n  return labels.join(" + ") || "priority Strong/Elite/HOT qualification";\n}\n''',
    '''function aiPriorityReviewCandidate(candidate: AiSelectorCandidate) {\n  const bestPlayLabel = `${candidate.bestPlayType || ""} ${candidate.bestPlay?.playType || ""}`.toUpperCase();\n  const marketSpecificBestPlay = Boolean(\n    candidate.bestPlayType && aiBestPlayQualification(candidate).qualifies,\n  );\n  return (\n    marketSpecificBestPlay ||\n    /\\b(STRONG|ELITE)\\b/.test(bestPlayLabel) ||\n    candidate.trendTier === "Strong" ||\n    candidate.trendTier === "Elite"\n  );\n}\n\nfunction aiPriorityReviewLabel(candidate: AiSelectorCandidate) {\n  const labels: string[] = [];\n  const rawBestPlay = String(candidate.bestPlay?.playType || candidate.bestPlayType || "").trim();\n  if (/\\b(STRONG|ELITE)\\b/i.test(rawBestPlay)) labels.push(rawBestPlay);\n  if (candidate.trendTier === "Strong" || candidate.trendTier === "Elite") {\n    labels.push(`${candidate.trendTier} Trend Play`);\n  }\n  if (candidate.bestPlayType) {\n    const qualification = aiBestPlayQualification(candidate);\n    if (qualification.qualifies) labels.push(qualification.label);\n  }\n  return labels.join(" + ") || "priority market-specific Best Play / Strong/Elite qualification";\n}\n''',
    "priority qualification",
)

core = replace_once(
    core,
    '''    const bestPlayProfile = aiPitcherQualificationProfile(\n      candidate.pitcherBetTypeForm,\n    );\n    const bestPlayRequiredScore =\n      candidate.pitcherRequiredScore || bestPlayProfile.score;\n    const hotBestPlay = candidate.pitcherBetTypeForm === EZPZ_BEST_PLAY_POLICY.requiredForm;\n\n    const qualifiesByBestPlay =\n      bestPlayBacked &&\n      hotBestPlay &&\n      aiScore >= bestPlayRequiredScore &&\n      (!bestPlayProfile.enforceProbability ||\n        estimatedProbability >= bestPlayProfile.probability) &&\n      (!implied || advantage >= bestPlayProfile.advantage);''',
    '''    const bestPlayQualification = aiBestPlayQualification(candidate);\n    const qualifiesByBestPlay =\n      bestPlayBacked &&\n      bestPlayQualification.qualifies;''',
    "finalizer Best Play qualification",
)

core = replace_once(
    core,
    '''      if (bestPlayBacked) {\n        if (!hotBestPlay) {\n          failures.push(\n            (candidate.bestPlayType || "Best Play") +\n              " is not HOT over its rolling Last 7 and is excluded because Best Play EZPZ Picks are HOT-only",\n          );\n        } else if (aiScore < bestPlayRequiredScore) {\n          failures.push(\n            "qualification score " + aiScore +\n              " did not reach the " + bestPlayRequiredScore +\n              " Best Play requirement",\n          );\n        } else if (\n          bestPlayProfile.enforceProbability &&\n          estimatedProbability < bestPlayProfile.probability\n        ) {\n          failures.push(\n            "Estimated probability " + estimatedProbability.toFixed(1) +\n              "% did not reach " + bestPlayProfile.probability.toFixed(1) +\n              "% for the Best Play path",\n          );\n        } else if (implied && advantage < bestPlayProfile.advantage) {\n          failures.push(\n            "Estimated advantage " + advantage.toFixed(1) +\n              "% did not reach " + bestPlayProfile.advantage.toFixed(2) +\n              "% for the Best Play path",\n          );\n        }\n      }''',
    '''      if (bestPlayBacked && !bestPlayQualification.qualifies && bestPlayQualification.failure) {\n        failures.push(bestPlayQualification.failure);\n      }''',
    "finalizer failure messages",
)

core = replace_once(
    core,
    '''          : qualifiesByBestPlay\n            ? "Live preview: qualifies through the " +\n              (candidate.pitcherBetTypeForm || "SAMPLE") +\n              " Best Play path; it locks from the frozen 15-minute pregame snapshot if that path still passes."\n            : "Live preview: qualifies through the Strong/Elite Trend Play path; it locks from the frozen 15-minute pregame snapshot if that path still passes."''',
    '''          : qualifiesByBestPlay\n            ? "Live preview: qualifies through the " +\n              (bestPlayQualification.label || candidate.market) +\n              " Best Play path; it locks from the frozen 15-minute pregame snapshot if that path still passes."\n            : "Live preview: qualifies through the Strong/Elite Trend Play path; it locks from the frozen 15-minute pregame snapshot if that path still passes."''',
    "live qualification note",
)

old_immediate = '''function aiQualifiesThroughHotBestPlayPath(\n  candidate: AiSelectorCandidate,\n  pick: AiPick,\n) {\n  if (\n    !candidate.bestPlayType ||\n    candidate.pitcherBetTypeForm !== EZPZ_BEST_PLAY_POLICY.requiredForm ||\n    pick.protectionStatus !== "PASSED"\n  ) {\n    return false;\n  }\n\n  const profile = aiPitcherQualificationProfile(\n    candidate.pitcherBetTypeForm,\n  );\n  const requiredScore = candidate.pitcherRequiredScore || profile.score;\n  const implied =\n    pick.marketImpliedProbability || aiImpliedProbability(pick.odds);\n\n  return (\n    pick.aiScore >= requiredScore &&\n    (!profile.enforceProbability ||\n      pick.estimatedProbability >= profile.probability) &&\n    (!implied || pick.estimatedAdvantage >= profile.advantage)\n  );\n}\n\nfunction finalizeImmediateHotBestPlays(\n  candidates: AiSelectorCandidate[],\n  storedFinalCandidateIds: Set<string>,\n) {\n  const qualifyingPicks: AiPick[] = [];\n\n  for (const candidate of candidates) {\n    if (\n      !candidate.bestPlayType ||\n      candidate.pitcherBetTypeForm !== EZPZ_BEST_PLAY_POLICY.requiredForm ||\n      storedFinalCandidateIds.has(candidate.candidateId)\n    ) {\n      continue;\n    }\n\n    const immediateCandidate: AiSelectorCandidate = {\n      ...candidate,\n      whySelected: [\n        AI_HOT_BEST_PLAY_FINAL_MARKER,\n        ...candidate.whySelected.filter(\n          (item) => item !== AI_HOT_BEST_PLAY_FINAL_MARKER,\n        ),\n      ],\n      dataStatus: [\n        AI_HOT_BEST_PLAY_FINAL_MARKER,\n        ...candidate.dataStatus.filter(\n          (item) => item !== AI_HOT_BEST_PLAY_FINAL_MARKER,\n        ),\n      ].slice(0, 5),\n    };\n    const pick = finalizeAiCandidates(\n      [immediateCandidate],\n      new Map(),\n      "NOT_REQUIRED",\n      "FINAL_PREGAME",\n    )[0];\n\n    // A Best + Trend candidate may qualify only through its trend path. Do not\n    // lock that wager early: immediate finalization belongs exclusively to the\n    // independent HOT Best Play path.\n    if (pick && aiQualifiesThroughHotBestPlayPath(immediateCandidate, pick)) {\n      qualifyingPicks.push(pick);\n    }\n  }\n\n  // Apply the one-Moneyline-or-Total-per-game rule across all newly final HOT\n  // Best Plays before persisting them. The losing comparison row is also saved\n  // as a terminal decision so it cannot reappear as a second pick on refresh.\n  return applyAiFullGameMarketLimit(qualifyingPicks);\n}\n'''
new_immediate = '''function aiQualifiesThroughBestPlayPath(\n  candidate: AiSelectorCandidate,\n  pick: AiPick,\n) {\n  return Boolean(\n    candidate.bestPlayType &&\n    pick.protectionStatus === "PASSED" &&\n    aiBestPlayQualification(candidate).qualifies\n  );\n}\n\nfunction finalizeImmediateBestPlays(\n  candidates: AiSelectorCandidate[],\n  storedFinalCandidateIds: Set<string>,\n) {\n  const qualifyingPicks: AiPick[] = [];\n\n  for (const candidate of candidates) {\n    if (\n      !candidate.bestPlayType ||\n      storedFinalCandidateIds.has(candidate.candidateId)\n    ) {\n      continue;\n    }\n\n    const immediateCandidate: AiSelectorCandidate = {\n      ...candidate,\n      whySelected: [\n        AI_BEST_PLAY_FINAL_MARKER,\n        ...candidate.whySelected.filter(\n          (item) => item !== AI_BEST_PLAY_FINAL_MARKER,\n        ),\n      ],\n      dataStatus: [\n        AI_BEST_PLAY_FINAL_MARKER,\n        ...candidate.dataStatus.filter(\n          (item) => item !== AI_BEST_PLAY_FINAL_MARKER,\n        ),\n      ].slice(0, 5),\n    };\n    const pick = finalizeAiCandidates(\n      [immediateCandidate],\n      new Map(),\n      "NOT_REQUIRED",\n      "FINAL_PREGAME",\n    )[0];\n\n    // A Best + Trend candidate may qualify only through its trend path. Do not\n    // lock that wager early unless its own market-specific Best Play rule passes.\n    if (pick && aiQualifiesThroughBestPlayPath(immediateCandidate, pick)) {\n      qualifyingPicks.push(pick);\n    }\n  }\n\n  // Apply the one-Moneyline-or-Total-per-game rule across all newly final\n  // market-qualified Best Plays before persisting them.\n  return applyAiFullGameMarketLimit(qualifyingPicks);\n}\n'''
core = replace_once(core, old_immediate, new_immediate, "immediate Best Play finalization")

core = replace_count(
    core,
    "AI_HOT_BEST_PLAY_FINAL_MARKER",
    "AI_BEST_PLAY_FINAL_MARKER",
    3,
    "remaining final marker references",
)

core = replace_once(
    core,
    '''  if (\n    pick.snapshotStatus !== "FINAL_PREGAME" ||\n    pick.externalReviewStatus !== "WEB_REVIEWED" ||\n    !pick.bestPlayType\n  ) {''',
    '''  if (\n    pick.snapshotStatus !== "FINAL_PREGAME" ||\n    pick.externalReviewStatus !== "WEB_REVIEWED" ||\n    !pick.bestPlayType ||\n    pick.market === "Pitcher Strikeouts"\n  ) {''',
    "stored Last-7 K exclusion",
)

core = replace_once(
    core,
    '''  const form = aiPitcherBetTypeForm(lastSeven);\n  const profile = aiPitcherQualificationProfile(form, lastSeven);\n  const formLabel =\n    form === "HOT"\n      ? "Hot"\n      : form === "NEUTRAL"\n        ? "Neutral"\n        : form === "COLD"\n          ? "Cold"\n          : "Small Sample";\n  const statusLine = `${recordType} Last 7 Bets: ${formLabel} • ${lastSeven.record}`;\n  const hasMarketImpliedProbability =\n    Number(pick.marketImpliedProbability || 0) > 0;\n\n  let failure = "";\n  if (form !== EZPZ_BEST_PLAY_POLICY.requiredForm) {\n    failure = `${recordType} is Cold over its last 7 completed bets (${lastSeven.record}); Cold Best Play bet types are excluded until the rolling record improves`;\n  } else if (pick.aiScore < profile.score) {\n    failure = `qualification score ${pick.aiScore} no longer reaches the current ${profile.score}+ requirement for ${recordType} (${formLabel}, ${lastSeven.record})`;\n  } else if (\n    profile.enforceProbability &&\n    pick.estimatedProbability < profile.probability\n  ) {\n    failure = `Estimated probability ${pick.estimatedProbability.toFixed(1)}% no longer reaches the current ${profile.probability}% requirement for ${recordType} (${formLabel}, ${lastSeven.record})`;\n  } else if (\n    hasMarketImpliedProbability &&\n    pick.estimatedAdvantage < profile.advantage\n  ) {\n    failure = `Estimated advantage ${pick.estimatedAdvantage.toFixed(1)}% no longer reaches the current ${profile.advantage.toFixed(1)}% requirement for ${recordType} (${formLabel}, ${lastSeven.record})`;\n  }''',
    '''  const form = aiPitcherBetTypeForm(lastSeven);\n  const policy = aiBestPlayPolicy(pick.market);\n  const formLabel =\n    form === "HOT"\n      ? "Hot"\n      : form === "NEUTRAL"\n        ? "Neutral"\n        : form === "COLD"\n          ? "Cold"\n          : "Small Sample";\n  const statusLine = `${recordType} Last 7 Bets: ${formLabel} • ${lastSeven.record}`;\n\n  let failure = "";\n  if (policy.requiredForm && form !== policy.requiredForm) {\n    failure = `${recordType} is ${formLabel} over its last 7 completed bets (${lastSeven.record}); ${pick.market} Best Play EZPZ Picks require ${policy.requiredForm} form`;\n  }''',
    "stored Last-7 market rule",
)

core = replace_once(
    core,
    '''  // Re-run only the free rolling Last-7 Best Play qualification gate against\n  // completed/locked AI picks before their game starts. The external web\n  // review remains frozen, so this never creates another OpenAI request.''',
    '''  // Re-run the rolling Last-7 gate only for markets that still use HOT\n  // (Moneyline, Total, First Inning). Pitcher K uses its reliability/probability\n  // rule at candidate creation and is intentionally excluded from this repair.''',
    "stored recheck comment",
)

core = replace_once(
    core,
    '''            pick.market === "Pitcher Strikeouts" &&\n            !pick.selected &&\n            (pick as AiSelectorCandidate).pitcherBetTypeForm === EZPZ_BEST_PLAY_POLICY.requiredForm &&\n            String(pick.rejectionReason || "").trim() === "Playable odds are missing"''',
    '''            pick.market === "Pitcher Strikeouts" &&\n            !pick.selected &&\n            String(pick.rejectionReason || "").trim() === "Playable odds are missing"''',
    "pitcher odds retry",
)

core = replace_once(
    core,
    '''  // HOT_BEST_PLAY_IMMEDIATE_FINAL_V1: Best Plays do not wait for the 15-minute\n  // finalization lifecycle. As soon as a HOT Best Play clears its score,\n  // probability, value, odds, and safety gates, save it as FINAL_PREGAME and\n  // keep that decision locked for the rest of the day. Trend-only candidates\n  // continue to use the frozen pregame snapshot below. Because the source is\n  // an already-saved Best Play, this path also repairs a missed same-day write\n  // after first pitch instead of allowing the play to disappear.\n  const immediateHotBestPlayDecisions = finalizeImmediateHotBestPlays(\n    candidates,\n    storedFinalCandidateIds,\n  );\n  if (immediateHotBestPlayDecisions.length) {\n    await persistAiPickRows(immediateHotBestPlayDecisions);\n    const finalizedCandidateIds = new Set(\n      immediateHotBestPlayDecisions.map((pick) => pick.candidateId),\n    );''',
    '''  // MARKET_BEST_PLAY_IMMEDIATE_FINAL_V2: Best Plays do not wait for the\n  // 15-minute lifecycle. As soon as a Best Play clears its own market-specific\n  // EZPZ rule plus the price/safety gates, save it as FINAL_PREGAME and keep\n  // that decision locked for the rest of the day. Trend-only candidates still\n  // use the frozen pregame snapshot below.\n  const immediateBestPlayDecisions = finalizeImmediateBestPlays(\n    candidates,\n    storedFinalCandidateIds,\n  );\n  if (immediateBestPlayDecisions.length) {\n    await persistAiPickRows(immediateBestPlayDecisions);\n    const finalizedCandidateIds = new Set(\n      immediateBestPlayDecisions.map((pick) => pick.candidateId),\n    );''',
    "immediate selector lifecycle",
)

core = replace_count(
    core,
    "immediateHotBestPlayDecisions",
    "immediateBestPlayDecisions",
    1,
    "remaining immediate decision variable",
)

page = replace_count(
    page,
    "isImmediateHotBestPlayFinal",
    "isImmediateBestPlayFinal",
    3,
    "page immediate-final variable",
)
page = replace_count(
    page,
    'item.startsWith("HOT Best Play is final for the full day")',
    'item.startsWith("EZPZ Best Play is final for the full day")',
    1,
    "page final marker prefix",
)
page = replace_count(
    page,
    "HOT Model Play saved as final for the full day",
    "EZPZ Best Play saved as final for the full day",
    1,
    "page final status label",
)

# Guardrails: the universal score/probability/advantage Best Play gates must be gone,
# and the new pitcher K thresholds must be present exactly once in the policy.
for forbidden in [
    "EZPZ_BEST_PLAY_POLICY",
    "aiPitcherQualificationProfile",
    "finalizeImmediateHotBestPlays",
    "AI_HOT_BEST_PLAY_FINAL_MARKER",
    "minimumScore: 74",
    "minimumProbability: 50",
    "minimumAdvantage: 1.5",
]:
    if forbidden in core:
        raise RuntimeError(f"forbidden legacy Best Play logic remains: {forbidden}")

for required in [
    'const AI_PICK_SELECTOR_VERSION = "ezpz-picks-market-specific-v8";',
    "const EZPZ_BEST_PLAY_POLICIES",
    "minimumReliability: 80",
    "minimumSelectedProbability: 65",
    'candidate.market === "Pitcher Strikeouts"',
    "function finalizeImmediateBestPlays",
    "function aiBestPlayQualification",
]:
    if required not in core:
        raise RuntimeError(f"required market-specific logic missing: {required}")

if "EZPZ Best Play is final for the full day" not in page:
    raise RuntimeError("page was not updated for generic market-specific Best Play finalization")

CORE.write_text(core)
PAGE.write_text(page)
print("Patched market-specific EZPZ Best Play qualification rules.")
