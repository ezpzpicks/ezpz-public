import { catalog as nfl } from "./nflCatalog";

// Start with the same market-only cohorts as NFL. Football weather, personnel,
// standings and model contexts do not become basketball evidence.
const rename = (value: unknown): any => typeof value === "string"
  ? value.replaceAll("NFL", "NBA").replaceAll("nfl-", "nba-")
  : Array.isArray(value) ? value.map(rename)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rename(v)])) : value;
const rules = nfl.rules.filter(rule => ["E", "H", "P"].includes(rule.data)).map(rename);
const filters = nfl.filters.filter(filter => ["E", "H", "P"].includes(filter.data)).map(rename);
const pairs = new Set(rules.map(rule => rule.id)), ids = new Set(filters.map(filter => filter.id));
export const catalog = {
  version: "nba-catalog-2026-10-22-v1", rules, filters,
  combinations: nfl.combinations.map(rename).filter(item => pairs.has(item.parent) && item.filters.every((id: string) => ids.has(id))),
};
