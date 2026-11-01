import { parseHTML } from "linkedom";
import { ncaamTeamKey, type NcaamGame } from "./ncaamMarketCore";
import { lineupStatus, type NbaGameLineup, type NbaLineupPlayer } from "./nbaLineupsCore";

export const NCAAM_LINEUP_SOURCE = "https://www.rotowire.com/daily/ncaab/lineups.php";
export function validNcaamLineupSource(value: string) {
  try { const url = new URL(value); return url.origin === "https://www.rotowire.com" && url.pathname === "/daily/ncaab/lineups.php"
    && !url.hash && (!url.search || /^\?slateID=[1-9]\d*$/.test(url.search)); } catch { return false; }
}
const text = (node: { textContent: string | null } | null) => node?.textContent?.trim() || "";

/** College cards are depth-chart projections. Card time, not page title, binds the slate. */
export function parseNcaamLineupsHtml(html: string, games: NcaamGame[], observedAt: string, sourceUrl = NCAAM_LINEUP_SOURCE) {
  if (html.length > 2_000_000 || !validNcaamLineupSource(sourceUrl) || !Number.isFinite(Date.parse(observedAt))) throw new Error("Invalid college lineup source.");
  const { document } = parseHTML(html), boxes = [...document.querySelectorAll(".lineup__box")];
  if (!boxes.length) throw new Error("College lineup cards are unavailable.");
  const output = new Map<string, NbaGameLineup>(), ambiguous = new Set<string>();
  const rejected: string[] = [];
  for (const box of boxes) {
    try {
      const sides = [["away", "is-visit"], ["home", "is-home"]] as const;
      const matches = games.filter(game => sides.every(([side, css]) => game.aliases[side].some(alias => ncaamTeamKey(alias) === ncaamTeamKey(text(box.querySelector(`.lineup__mteam.${css}`))))));
      if (!matches.length) continue;
      if (matches.length !== 1) throw new Error("Ambiguous college matchup.");
      const game = matches[0], stamp = new Date(game.tipoff);
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(stamp);
      const part = (type: string) => parts.find(p => p.type === type)?.value || "";
      const clockNode = box.parentElement?.querySelector(".lineup__time");
      const clockText = clockNode ? [...clockNode.childNodes].map(n => n.textContent).join(" ").trim() : "";
      const clock = clockText.match(/^([A-Z]{3})\s+(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+([AP]M)\s+ET$/i);
      if (!clock || clock[1].toLowerCase() !== part("weekday").toLowerCase() || Number(clock[2]) !== Number(part("month")) || Number(clock[3]) !== Number(part("day"))
        || Number(clock[4]) !== Number(part("hour")) || clock[5] !== part("minute") || clock[6].toUpperCase() !== part("dayPeriod")) throw new Error("College lineup time differs from ESPN.");
      if (output.has(game.gameId) || ambiguous.has(game.gameId)) { ambiguous.add(game.gameId); throw new Error("Duplicate college matchup."); }
      const lineup: NbaGameLineup = { sport: "NCAAM", gameId: game.gameId, date: game.date, tipoff: game.tipoff, observedAt, source: "RotoWire", sourceUrl,
        basis: "Depth chart projections", away: { team: game.away, confirmed: false, starters: [], injuries: [] }, home: { team: game.home, confirmed: false, starters: [], injuries: [] } };
      const used = new Set<string>();
      for (const [side, css] of sides) {
        const listing = box.querySelector(`.lineup__list.${css}`);
        if (!listing) throw new Error("Missing college team list.");
        let injurySection = false;
        const players = new Map<string, NbaLineupPlayer>(), starters: string[] = [], injuries: string[] = [];
        for (const row of [...listing.children]) {
          if (row.classList.contains("lineup__title")) { if (text(row).toLowerCase() !== "injuries") throw new Error("Unknown college availability section."); injurySection = true; }
          if (!row.classList.contains("lineup__player")) continue;
          const link = row.querySelector("a[href]"), identity = link?.getAttribute("href")?.match(/^\/cbasketball\/player\/[^/?#]+-([1-9]\d*)$/)?.[1];
          const name = link?.getAttribute("title")?.trim(), labels = [...row.children].filter(n => n.tagName === "SPAN").map(n => text(n)).filter(Boolean);
          const label = labels[0]?.toUpperCase() || "", status = lineupStatus(label === "GTD" ? "QUESTIONABLE" : label);
          if (!identity || !name || labels.length > 1 || status == null) throw new Error("Unverified college player identity or status.");
          const id = `rotowire:${identity}`, position = text(row.querySelector(".lineup__pos")), previous = players.get(id);
          if (previous && (previous.name !== name || previous.status !== status)) throw new Error("Conflicting college player status.");
          if (previous && !injurySection && !previous.position.split("/").includes(position)) previous.position += "/" + position;
          if (!previous) players.set(id, { id, name, status, position });
          if (injurySection) { if (!starters.includes(id) && !injuries.includes(id)) injuries.push(id); }
          else if (!starters.includes(id)) starters.push(id);
        }
        if (starters.length > 5 || [...players.keys()].some(id => used.has(id)) || starters.some(id => ["OUT", "DOUBTFUL"].includes(players.get(id)!.status))) throw new Error("Ambiguous college starting lineup.");
        players.forEach((_, id) => used.add(id));
        lineup[side] = { team: game[side], confirmed: false, complete: starters.length === 5,
          starters: starters.map(id => players.get(id)!), injuries: injuries.map(id => players.get(id)!) };
      }
      output.set(game.gameId, lineup);
    } catch (error) { rejected.push(error instanceof Error ? error.message : String(error)); }
  }
  const days = new Set(games.map(g => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${g.date}T12:00:00Z`))));
  const links = [...document.querySelectorAll("a[href]")].flatMap(link => {
    const url = new URL(link.getAttribute("href")!, NCAAM_LINEUP_SOURCE).href;
    return validNcaamLineupSource(url) && url.includes("?slateID=") && [...days].some(day => new RegExp(`\\b${day}(?!\\d)`).test(text(link))) ? [url] : [];
  });
  return { lineups: [...output.values()].filter(l => !ambiguous.has(l.gameId)), links: [...new Set(links)], rejected };
}
