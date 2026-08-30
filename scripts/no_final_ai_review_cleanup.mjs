// Legacy compatibility step retained in prebuild.
//
// This script previously rewrote the selector to HOT-only Best Play admission.
// That override conflicted with the tiered rolling Last-7 policy already present
// in app/api/public-data/route.ts:
//   HOT: 74 score / 50% probability / 1.5% advantage
//   NEUTRAL: 80 / 52.5% / 3.25%
//   SAMPLE: 86 / 55% / 5%
//   COLD: blocked
//
// Do not mutate the route here. The deterministic final-snapshot patch keeps the
// tiered qualification block intact, and EZPZ Picks should use those thresholds.
console.log("Preserving tiered Best Play Last-7 qualification; legacy HOT-only override disabled.");
