export const NCAAF_TREND_RECORD_POLICY = "verified-final-snapshot-v1";

// Only the server's timestamp-validated, regraded snapshot ledger may feed
// NCAAF trend records. A legacy FINAL label is not sufficient evidence.
export function isVerifiedNcaafTrendRecord(row: Record<string, unknown>) {
  return row["Record Snapshot Policy"] === NCAAF_TREND_RECORD_POLICY
    && row["Snapshot Status"] === "FINAL_PREGAME"
    && Boolean(String(row["Public Split Snapshot Time"] || "").trim());
}
