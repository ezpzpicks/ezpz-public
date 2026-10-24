/** Reconnect feed spellings of A&M without shortening the school to Texas. */
export function normalizeTexasAmAlias(value: unknown): string {
  return String(value ?? "").replace(/\btexas\s+a(?:\s*(?:&|and)\s*|\s*)m\b/gi, "Texas A&M");
}
