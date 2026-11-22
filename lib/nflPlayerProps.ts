export type NflPropRow = Record<string, string>;
export type NflPlayerProp = {
  id: string; gameId: string; game: string; gameTime: string;
  player: string; team: string; market: string; projection: number | null;
  line: number | null; overOdds: number | null; underOdds: number | null;
  pick: string; pickOdds: number | null; probability: number | null;
  grade: string; qualified: boolean; phase: "early" | "pregame" | "saved";
  builtAt: string; quoteObservedAt: string; lineSource: string;
};

export function nflPropsDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function validNflPropsDate(value: string) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T12:00:00Z"))
    && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
}

function number(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(/−/g, "-"));
  return Number.isFinite(n) ? n : null;
}

function key(row: NflPropRow) {
  return row["Game ID"] || row.Game || "";
}

// Match the existing public NFL yardage tiers; pending visibility does not
// relax grades or promote availability holds into selections.
export function nflPropDisplayGrade(row: NflPropRow) {
  const stored = row.Grade || "Projection only";
  if (/hold|no play|missing|no market|projection only/i.test(stored)) return stored;
  const market = String(row.Market || "").toLowerCase();
  if (!["passing yards", "rushing yards", "receiving yards"].includes(market)) return stored;
  const line = number(row["Market Line"]), probabilityEdge = number(row["Probability Edge"]);
  const projection = number(row.Projection), storedGap = number(row["Projection Edge"]);
  if (line == null || line <= 0 || probabilityEdge == null || (storedGap == null && projection == null)) return stored;
  if ((market === "passing yards" && (line < 100 || line > 400)) || (market !== "passing yards" && line > 200)) return stored;
  const gap = Math.abs(storedGap ?? (projection! - line));
  const edge = probabilityEdge <= 1 ? probabilityEdge * 100 : probabilityEdge;
  if (100 * gap / line < 30 || edge < 12) return "Non-Edge";
  return edge >= 30 ? "Strong" : edge >= 16 ? "Regular" : "Lean";
}

export function upcomingNflProps(props: NflPlayerProp[], now = Date.now(), pendingOnly = false) {
  return props.filter(prop => prop.qualified && Date.parse(prop.gameTime) > now
    && (!pendingOnly || prop.phase === "early"));
}

/** A final game's complete batch replaces its morning batch, including removed players. */
export function buildNflPlayerProps(locked: NflPropRow[], previews: NflPropRow[], date: string,
  slate: NflPropRow[] = []): NflPlayerProp[] {
  const finals = locked.filter(row => row.Date === date && row.Player && row.Market && key(row));
  const finalGames = new Set(finals.map(key));
  const candidates = [...previews.filter(row => row.Date === date && !finalGames.has(key(row))), ...finals];
  const unique = new Map<string, NflPlayerProp>();
  for (const row of candidates) {
    if (!row.Player || !row.Market || !key(row)) continue;
    const id = `${date}|${key(row)}|${row.Player.toLowerCase()}|${row.Market.toLowerCase()}`;
    const game = slate.find(g => key(g) === key(row));
    const grade = nflPropDisplayGrade(row);
    const prop: NflPlayerProp = {
      id, gameId: key(row), game: row.Game || game?.Game || key(row),
      gameTime: row["Game Time"] || game?.["Game Time"] || "",
      player: row.Player, team: row.Team || "", market: row.Market,
      projection: number(row.Projection), line: number(row["Market Line"]),
      overOdds: number(row["Over Odds"]), underOdds: number(row["Under Odds"]),
      pick: row.Pick || "Projection only", pickOdds: number(row["Pick Odds"]),
      probability: number(row["Model Probability"]), grade,
      qualified: ["passing yards", "rushing yards", "receiving yards"].includes(row.Market.toLowerCase())
        ? /^(Strong|Regular|Lean)$/i.test(grade) : /^(A Prop|B Prop)$/i.test(grade),
      phase: row["Build Phase"] === "early" ? "early" : row["Build Phase"] === "pregame" ? "pregame" : "saved",
      builtAt: row["Build At"] || "", quoteObservedAt: row["Quote Observed At"] || "",
      lineSource: row["Line Source"] || "",
    };
    // The preview dataset is always a preview, including older backfilled rows.
    if (!finalGames.has(key(row))) prop.phase = "early";
    const previous = unique.get(id);
    if (!previous || (Date.parse(prop.builtAt) || 0) >= (Date.parse(previous.builtAt) || 0)) unique.set(id, prop);
  }
  return [...unique.values()].sort((a, b) => a.gameTime.localeCompare(b.gameTime)
    || a.game.localeCompare(b.game) || a.player.localeCompare(b.player) || a.market.localeCompare(b.market));
}
