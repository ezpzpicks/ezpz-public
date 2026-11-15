/** Keep rating, schedule and market identities on one normalization rule. */
export const ncaamTeamKey = (name: string) => name.toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/\b(?:saint|state)\b/g, "st")
  .replace(/[^a-z0-9]+/g, " ").trim();
