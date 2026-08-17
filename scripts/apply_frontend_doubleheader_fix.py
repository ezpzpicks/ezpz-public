from pathlib import Path


def one(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


path = Path("app/page.tsx")
s = path.read_text()

s = one(
    s,
    'type DraftKingsSplit = {\n  date: string;\n  game: string;',
    'type DraftKingsSplit = {\n  date: string;\n  eventTime?: string;\n  game: string;',
    "frontend split type",
)
s = one(
    s,
    'type DraftKingsProp = {\n  date: string;\n  game: string;',
    'type DraftKingsProp = {\n  date: string;\n  eventTime?: string;\n  game: string;',
    "frontend prop type",
)

old = '''function sameDraftKingsGame(
  row: SheetRow | undefined,
  marketRow: { date?: string; awayTeam: string; homeTeam: string },
) {
  if (!row) return false;
  const awayMatch = publicMatchKey(row["Away Team"]) === publicMatchKey(marketRow.awayTeam);
  const homeMatch = publicMatchKey(row["Home Team"]) === publicMatchKey(marketRow.homeTeam);
  if (!awayMatch || !homeMatch) return false;
  const rowDate = normalizedPublicDate(row["Date"]);
  const marketDate = normalizedPublicDate(marketRow.date);
  return !rowDate || !marketDate || rowDate === marketDate;
}
'''
new = '''function draftKingsEventTimeKey(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const meridiem = raw.match(/(?:^|[,\\s])(\\d{1,2})(?::(\\d{2}))\\s*(AM|PM)\\b/i);
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3].toUpperCase() === "PM") hour += 12;
    return `${String(hour).padStart(2, "0")}:${String(Number(meridiem[2] || 0)).padStart(2, "0")}`;
  }
  const clock24 = raw.match(/(?:^|[T,\\s])([01]?\\d|2[0-3]):([0-5]\\d)(?::\\d{2})?(?:\\s*(?:ET|EST|EDT))?\\s*$/i);
  if (clock24) return `${String(Number(clock24[1])).padStart(2, "0")}:${clock24[2]}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(parsed);
    const hour = parts.find((part) => part.type === "hour")?.value || "";
    const minute = parts.find((part) => part.type === "minute")?.value || "";
    if (hour && minute) return `${hour}:${minute}`;
  }
  return "";
}

function draftKingsRowTimeKey(row: SheetRow | undefined) {
  if (!row) return "";
  const raw = [
    "Game Time ET",
    "Game Time",
    "Game Start Time",
    "Scheduled Start",
    "Start Time",
    "Scheduled Time",
    "First Pitch",
    "Time",
  ]
    .map((column) => String(row[column] || "").trim())
    .find(Boolean) || "";
  return draftKingsEventTimeKey(raw);
}

function sameDraftKingsGame(
  row: SheetRow | undefined,
  marketRow: { date?: string; awayTeam: string; homeTeam: string; eventTime?: string },
) {
  if (!row) return false;
  const awayMatch = publicMatchKey(row["Away Team"]) === publicMatchKey(marketRow.awayTeam);
  const homeMatch = publicMatchKey(row["Home Team"]) === publicMatchKey(marketRow.homeTeam);
  if (!awayMatch || !homeMatch) return false;
  const rowDate = normalizedPublicDate(row["Date"]);
  const marketDate = normalizedPublicDate(marketRow.date);
  if (rowDate && marketDate && rowDate !== marketDate) return false;
  const rowTime = draftKingsRowTimeKey(row);
  const marketTime = draftKingsEventTimeKey(marketRow.eventTime || "");
  return !rowTime || !marketTime || rowTime === marketTime;
}
'''
s = one(s, old, new, "frontend same-game matcher")

path.write_text(s)
print("Frontend doubleheader matcher patched.")
