/** Date-only slate keys are calendar dates, never browser-local instants. */
export function fullSlateDateKey(value: string) {
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const key = us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  const stamp = Date.parse(`${key}T12:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === key ? key : "";
}
export function formatFullSlateDate(value: string, now = new Date()) {
  const key = fullSlateDateKey(value);
  if (!key) return value;
  const year = new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York",year:"numeric"}).format(now);
  return new Intl.DateTimeFormat("en-US", {timeZone:"UTC",weekday:"short",month:"short",day:"numeric",
    ...(key.slice(0,4) !== year ? {year:"numeric" as const} : {})}).format(new Date(`${key}T12:00:00Z`));
}
