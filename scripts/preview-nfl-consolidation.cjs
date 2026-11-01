/** Read-only: node scripts/preview-nfl-consolidation.cjs BOARD_JSON [SIGNAL_ARCHIVE_JSON ...] */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { restoreFootballPublicDisplay } = require('../lib/footballPublicDisplay.ts');
const defs = require('../lib/catalog/nflConsolidatedCatalog.ts');
const grouped = require('../lib/nflConsolidatedTrends.ts');
const { replayNflConsolidatedSignals } = require('../lib/nflConsolidatedResearch.ts');
const research = require('../lib/signalCombinationResearch.ts');
const [file, ...archives] = process.argv.slice(2);
if (!file) throw new Error('Provide a saved public NFL board JSON path.');
const data = restoreFootballPublicDisplay(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
if (data.sport !== 'NFL' || !data.ok) throw new Error('Expected a successful saved NFL board.');
const now = Date.parse(data.footballSignals?.asOf || '') || Date.now();
const sides = new Map();
for (const source of [data.footballSignals || {}, ...archives.map(file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')))]) {
  for (const side of source.sides || []) if (side.recorded) sides.set(side.id, side);
}
const original = [...sides.values()];
const replay = replayNflConsolidatedSignals(original, data.trendRecordRows || [], data.trendPlays || [], now);
const oldPolicy = 'football-signals-2026-10-18-v1';
const baseline = research.buildSignalResearchReport('NFL', oldPolicy, research.buildSignalResearchDays(original, oldPolicy, now));
const proposed = research.buildSignalResearchReport('NFL', defs.NFL_CONSOLIDATED_SIGNAL_POLICY,
  research.buildSignalResearchDays(replay.observations, defs.NFL_CONSOLIDATED_SIGNAL_POLICY, now));
const stats = grouped.buildNflConsolidatedSubtypes(data.trendRecordRows || []);
const ranked = grouped.buildNflConsolidatedLeaderboard(data.trendRecordRows || [], now);
const cells = report => report.cells.map(cell => ({ ...cell, stats: { ...cell.stats,
  record: `${cell.stats.wins}-${cell.stats.losses}-${cell.stats.pushes}`,
  roiPct: cell.stats.wins + cell.stats.losses + cell.stats.pushes
    ? 100 * cell.stats.netUnits / (cell.stats.wins + cell.stats.losses + cell.stats.pushes) : null } }));
process.stdout.write(JSON.stringify({ asOf: new Date(now).toISOString(), version: defs.NFL_CONSOLIDATED_VERSION,
  definitions: defs.NFL_CONSOLIDATED_TYPES, stats, ranked, originalCapturedObservations: original.length,
  reclassification: replay.status, originalCombos: cells(baseline), groupedCombos: cells(proposed) }, null, 2) + '\n');
