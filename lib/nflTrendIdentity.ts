const TEAMS: Record<string, string> = {
  ari: "cardinals", atl: "falcons", bal: "ravens", buf: "bills", car: "panthers",
  chi: "bears", cin: "bengals", cle: "browns", dal: "cowboys", den: "broncos",
  det: "lions", gb: "packers", hou: "texans", ind: "colts", jac: "jaguars", jax: "jaguars",
  kc: "chiefs", lv: "raiders", lac: "chargers", la: "rams", lar: "rams", mia: "dolphins",
  min: "vikings", ne: "patriots", no: "saints", nyg: "giants", nyj: "jets", phi: "eagles",
  pit: "steelers", sea: "seahawks", sf: "49ers", tb: "buccaneers", ten: "titans",
  was: "commanders", wsh: "commanders",
};
const MASCOTS = new Set(Object.values(TEAMS));

export function nflTrendTeamKey(value: unknown) {
  const key = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const mascot = key.split(" ").at(-1) || "";
  return TEAMS[key] || (MASCOTS.has(mascot) ? mascot : key);
}

export function nflTrendGameIdentity(play: Record<string, any>) {
  const teams = String(play.game || play.Game || "").split(/\s*(?:@|\bat\b|\bvs\.?\b|\bversus\b)\s*/i)
    .map(nflTrendTeamKey).filter(Boolean).sort();
  return `${play.date || play.Date || ""}|${teams.join("|")}`;
}
