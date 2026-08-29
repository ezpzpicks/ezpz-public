import fs from "node:fs";

const path = "lib/footballWeeklyMarket.ts";
let text = fs.readFileSync(path, "utf8");

const groupsBefore = '  const groups = sport === "NFL" ? ["NFL"] : ["College Football", "NCAAF", "CFB"];';
const groupsOldIds = '  const groups = sport === "NFL" ? ["42648"] : ["88808", "94682", "212333"];';
const groupsAfter = '  const groups = sport === "NFL" ? ["84240"] : ["NCAA Football"];';
if (text.includes(groupsBefore)) text = text.replace(groupsBefore, groupsAfter);
else if (text.includes(groupsOldIds)) text = text.replace(groupsOldIds, groupsAfter);
else if (!text.includes(groupsAfter)) throw new Error("Could not patch weekly football DraftKings event groups");

const horizonsBefore = '  for (const group of groups) {\n    for (const horizon of ["n7days", ""]) {';
const horizonsAfter = '  const horizons = sport === "NFL" ? ["n7days"] : ["n30days"];\n  for (const group of groups) {\n    for (const horizon of horizons) {';
if (text.includes(horizonsBefore)) text = text.replace(horizonsBefore, horizonsAfter);
else if (!text.includes(horizonsAfter)) throw new Error("Could not patch weekly football DraftKings date window");

const loopBefore = `  const horizons = sport === "NFL" ? ["n7days"] : ["n30days"];
  for (const group of groups) {
    for (const horizon of horizons) {
      try {
        for (let page = 1; page <= 10; page += 1) {
          const parsed = parseBettingSplits(await fetchHtml({
            itm_content: group,
            tb_eg: group,
            tb_page: String(page),
            ...(horizon ? { tb_edate: horizon } : {}),
          }));
          if (!parsed.length) break;
          for (const split of parsed) {
            const key = \`\${split.date}|\${textKey(split.game)}|\${split.market}|\${textKey(split.selection)}\`;
            map.set(key, split);
          }
        }
      } catch (error) {
        errors.push(\`\${group}\${horizon ? \`/\${horizon}\` : ""}: \${error instanceof Error ? error.message : String(error)}\`);
      }
    }
  }`;

const loopAfter = `  const horizons = sport === "NFL" ? ["n7days"] : ["n30days"];
  const marketFilters = sport === "NFL" ? ["Spread", "Total"] : [""];
  for (const group of groups) {
    for (const horizon of horizons) {
      for (const marketFilter of marketFilters) {
        try {
          for (let page = 1; page <= 10; page += 1) {
            const parsed = parseBettingSplits(await fetchHtml({
              itm_content: group,
              tb_eg: group,
              tb_page: String(page),
              ...(horizon ? { tb_edate: horizon } : {}),
              ...(marketFilter ? { tb_emt: marketFilter } : {}),
            }));
            if (!parsed.length) break;
            for (const split of parsed) {
              const key = \`\${split.date}|\${textKey(split.game)}|\${split.market}|\${textKey(split.selection)}\`;
              map.set(key, split);
            }
          }
        } catch (error) {
          errors.push(\`\${group}\${horizon ? \`/\${horizon}\` : ""}\${marketFilter ? \`/\${marketFilter}\` : ""}: \${error instanceof Error ? error.message : String(error)}\`);
        }
      }
    }
  }`;

if (text.includes(loopBefore)) text = text.replace(loopBefore, loopAfter);
else if (!text.includes('const marketFilters = sport === "NFL" ? ["Spread", "Total"] : [""];')) {
  throw new Error("Could not patch weekly NFL market-specific discovery loops");
}

const numericBefore = `function numericLine(value: unknown) {
  const match = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\\d+(?:\\.\\d+)?/);
  const n = match ? Number(match[0]) : NaN;
  return Number.isFinite(n) ? n : null;
}`;
const numericAfter = `function numericLine(value: unknown) {
  const matches = String(value || "").replace(/[−–—]/g, "-").match(/[+-]?\\d+(?:\\.\\d+)?/g);
  const raw = matches?.length ? matches[matches.length - 1] : "";
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}`;
if (text.includes(numericBefore)) text = text.replace(numericBefore, numericAfter);
else if (!text.includes(numericAfter)) throw new Error("Could not patch weekly football numeric line parser");

if (!text.includes('tb_emt: marketFilter')) throw new Error("NFL weekly market-specific feed patch did not apply");

fs.writeFileSync(path, text);
console.log("Aligned weekly football discovery with current CFB feed and market-specific NFL Spread/Total feeds.");
