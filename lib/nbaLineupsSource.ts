import { parseHTML } from "linkedom";
import { NBA_LINEUP_SOURCE, lineupFromRotoWireReport, lineupStatus, type NbaLineupGame, type NbaGameLineup } from "./nbaLineupsCore";

const TEAMS: Record<string, string> = {
  ATL: "Atlanta Hawks", BOS: "Boston Celtics", BKN: "Brooklyn Nets", CHA: "Charlotte Hornets",
  CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers", DAL: "Dallas Mavericks", DEN: "Denver Nuggets",
  DET: "Detroit Pistons", GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers",
  LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies", MIA: "Miami Heat",
  MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves", NOP: "New Orleans Pelicans", NYK: "New York Knicks",
  OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers", SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors",
  UTA: "Utah Jazz", WAS: "Washington Wizards",
};
const ALIASES: Record<string, string> = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTH: "UTA", PHO: "PHX", BRK: "BKN" };

/** Only public starting fives and availability labels; never subscription minutes. */
export function parseNbaLineupsHtml(html: string, date: string, games: NbaLineupGame[], observedAt: string): NbaGameLineup[] {
  if (html.length > 2_000_000) throw new Error("NBA lineup page exceeds the size limit.");
  const { document } = parseHTML(html);
  const expected = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })
    .format(new Date(`${date}T12:00:00Z`));
  if (document.querySelector(".page-title__secondary")?.textContent?.trim() !== `Starting lineups for ${expected}`)
    throw new Error("NBA lineup source belongs to another slate date.");
  const cards = [...document.querySelectorAll("div.lineup.is-nba[data-lnum]")];
  if (!cards.length) throw new Error("NBA lineup source has no matchup cards.");
  const report: any = { provider: "RotoWire", date, fetched_at: observedAt, source_url: NBA_LINEUP_SOURCE, games: [] };
  for (const card of cards) {
    const entry: any = {};
    let valid = true;
    for (const [side, css] of [["away", "is-visit"], ["home", "is-home"]]) {
      const abbr = card.querySelector(`.lineup__team.${css} .lineup__abbr`)?.textContent?.trim() || "";
      const team = TEAMS[ALIASES[abbr] || abbr], listing = card.querySelector(`ul.lineup__list.${css}`);
      const state = listing?.querySelector(".lineup__status"), label = state?.textContent?.trim();
      const confirmed = label === "Confirmed Lineup" && state?.classList.contains("is-confirmed");
      const projected = label === "Expected Lineup" && state?.classList.contains("is-expected");
      if (!team || !listing || (!confirmed && !projected)) { valid = false; break; }
      const players: any[] = [], starters: string[] = [];
      let injurySection = false;
      for (const row of [...listing.children]) {
        if (row.classList.contains("lineup__title")) {
          if (row.textContent?.trim().toUpperCase() !== "MAY NOT PLAY") { valid = false; break; }
          injurySection = true;
        }
        if (!row.classList.contains("lineup__player")) continue;
        const link = row.querySelector("a[href]"), name = link?.getAttribute("title")?.trim();
        const id = link?.getAttribute("href")?.match(/^\/basketball\/player\/[^/?#]+-([1-9]\d*)$/)?.[1];
        const labels = [...row.querySelectorAll(".lineup__inj")];
        const sourceStatus = labels[0]?.textContent?.trim() || "", status = lineupStatus(sourceStatus);
        if (!id || !name || labels.length > 1 || status == null || (row.classList.contains("has-injury-status") && !sourceStatus)) {
          valid = false; break;
        }
        const playerId = `rotowire:${id}`;
        if (players.some(player => player.player_id === playerId)) {
          // The source can repeat a questionable starter in MAY NOT PLAY.
          const previous = players.find(player => player.player_id === playerId);
          if (previous.name !== name || previous.status !== status) valid = false;
          continue;
        }
        players.push({ player_id: playerId, name, status, position: row.querySelector(".lineup__pos")?.textContent?.trim() || "" });
        if (!injurySection) starters.push(playerId);
      }
      entry[side] = { team, confirmed: Boolean(confirmed), starters, players };
    }
    if (valid) report.games.push(entry);
  }
  return games.flatMap(game => { const lineup = lineupFromRotoWireReport(game, report); return lineup ? [lineup] : []; });
}
