type Game = Record<string, string>;

export function selectFootballPublicWeek(games: Game[], today: string, requestedWeek = "") {
  const dated = games.filter(row => row.Date && row.Week)
    .sort((a, b) => a.Date.localeCompare(b.Date));
  const availableWeeks = [...new Set(dated.map(row => row.Week))].sort((a, b) =>
    Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0) || a.localeCompare(b));
  const defaultGame = dated.find(row => row.Date === today)
    || dated.find(row => row.Date > today) || dated.at(-1);
  const selectedWeek = availableWeeks.includes(requestedWeek) ? requestedWeek : defaultGame?.Week || "";
  const dateKeys = [...new Set(dated.filter(row => row.Week === selectedWeek).map(row => row.Date))];
  return { availableWeeks, selectedWeek, dateKeys };
}
